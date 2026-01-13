const { graphql } = require("@octokit/graphql");
const { subMonths, startOfMonth, endOfMonth, format } = require("date-fns");

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const graphqlWithAuth = graphql.defaults({
    headers: {
      authorization: `token ${token}`,
    },
  });

  // Calculate dates
  const now = process.env.DATE_OVERRIDE ? new Date(process.env.DATE_OVERRIDE) : new Date();
  const lastMonthDate = subMonths(now, 1);
  const start = startOfMonth(lastMonthDate);
  const end = endOfMonth(lastMonthDate);

  const formattedStart = format(start, "yyyy-MM-dd");
  const formattedEnd = format(end, "yyyy-MM-dd");
  const niceMonthName = format(start, "MMMM yyyy");

  console.log(`Generating roundup for ${niceMonthName} (${formattedStart} to ${formattedEnd})...`);

  // We want to capture ALL activity unique items
  // We want to capture PR activity specifically (Opened, Closed, Merged)
  // Capture any PR activity (Opened, Closed, Merged, Updated)
  const prsBodyQuery = `repo:webmachinelearning/webmcp is:pr updated:${formattedStart}..${formattedEnd}`;

  // For Issues, we want anything that had activity (updated)
  const issuesBodyQuery = `repo:webmachinelearning/webmcp is:issue updated:${formattedStart}..${formattedEnd}`;

  // Also fetch discussions to capture contributors
  const discussionQuery = `repo:webmachinelearning/webmcp type:discussion updated:${formattedStart}..${formattedEnd}`;

  // Helper to fetch all pages (simplified to 100)
  // We explicitly fetch participants (comments/reviews) to populate the contributors list robustly
  const fetchItems = async (q) => {
    try {
      const { search } = await graphqlWithAuth(`
        query($q: String!) {
          search(query: $q, type: ISSUE, first: 100) {
            nodes {
              ... on PullRequest {
                __typename
                number
                title
                url
                state
                createdAt
                updatedAt
                closedAt
                mergedAt
                author { login url }
                comments(first: 20) { nodes { author { login url } } }
                reviews(first: 20) { nodes { author { login url } } }
              }
              ... on Issue {
                __typename
                number
                title
                url
                state
                createdAt
                updatedAt
                closedAt
                author { login url }
                comments(first: 20) { nodes { author { login url } } }
              }
            }
          }
        }
      `, { q });
      return search.nodes;
    } catch (e) {
      console.warn("Error fetching items, returning empty", e.message);
      return [];
    }
  };

  // Fetch discussions separately if ISSUE search doesn't cover it (Search type ISSUE covers issues/PRs usually)
  // Discussion API is strictly separate in GraphQL. We'll skip complex discussion fetching for now to ensure stability 
  // unless we use a specific Repository.discussions query, which is safer.
  // Instead, rely on Issue/PR participants which is the bulk of "contributors".

  const [prItems, issueItems] = await Promise.all([
    fetchItems(prsBodyQuery),
    fetchItems(issuesBodyQuery)
  ]);

  // Combine and Deduplicate
  const allItems = new Map();
  const contributors = new Map(); // Login -> Url

  const addContributor = (author) => {
    if (author && author.login) {
      contributors.set(author.login, author.url);
    }
  };

  [...prItems, ...issueItems].forEach(item => {
    allItems.set(item.url, item);
    addContributor(item.author);

    // Scan comments/reviews
    if (item.comments && item.comments.nodes) {
      item.comments.nodes.forEach(c => addContributor(c.author));
    }
    if (item.reviews && item.reviews.nodes) {
      item.reviews.nodes.forEach(r => addContributor(r.author));
    }
  });

  const prs = [];
  const issues = [];

  for (const item of allItems.values()) {
    if (item.__typename === 'PullRequest') prs.push(item);
    else issues.push(item);
  }

  prs.sort((a, b) => a.number - b.number);
  issues.sort((a, b) => a.number - b.number);

  console.log(`Found ${prs.length} Unique PRs and ${issues.length} Unique Issues.`);

  if (prs.length === 0 && issues.length === 0) {
    console.log("No activity found.");
    return;
  }

  // Formatting Helpers
  const formatDate = (d) => format(new Date(d), "MMM d");

  const formatBullet = (item) => {
    // Determine Status
    const createdInMonth = item.createdAt >= formattedStart && item.createdAt <= formattedEnd;

    let icon = "⚪";
    let statusText = "Active";
    let date = "";

    if (item.__typename === 'PullRequest') {
      const mergedInMonth = item.mergedAt && item.mergedAt >= formattedStart && item.mergedAt <= formattedEnd;
      const closedInMonth = item.closedAt && item.closedAt >= formattedStart && item.closedAt <= formattedEnd;

      if (mergedInMonth) {
        icon = "✅";
        statusText = "Merged on";
        date = item.mergedAt;
      } else if (closedInMonth) {
        icon = "🔴";
        statusText = "Closed on";
        date = item.closedAt;
      } else if (createdInMonth) {
        icon = "🚧";
        statusText = "Opened on";
        date = item.createdAt;
      } else {
        icon = "🔄";
        statusText = "Active";
        date = item.updatedAt;
      }
    } else {
      // Issues
      const closedInMonth = item.closedAt && item.closedAt >= formattedStart && item.closedAt <= formattedEnd;

      if (closedInMonth) {
        icon = "✅";
        statusText = "Closed on";
        date = item.closedAt;
      } else if (createdInMonth) {
        icon = "🚧";
        statusText = "Opened on";
        date = item.createdAt;
      } else {
        icon = "🔄";
        statusText = "Active";
        date = item.updatedAt;
      }
    }

    const linkedStatus = date ? `[${statusText} ${formatDate(date)}](${item.url})` : `[${statusText}](${item.url})`;
    const authorLink = item.author ? `[@${item.author.login}](${item.author.url})` : "unknown";

    return `- ${icon} [${item.title}](${item.url}) (${linkedStatus} by ${authorLink})`;
  };

  // Conversational Summary
  const generateSummary = (prsNodes) => {
    const significantPRs = prsNodes.filter(pr => {
      // Only highlight PRs merged in this month
      const mergedInMonth = pr.mergedAt && pr.mergedAt >= formattedStart && pr.mergedAt <= formattedEnd;
      if (!mergedInMonth) return false;

      const t = pr.title.toLowerCase();
      return t.includes("feat") || t.includes("add") || t.includes("support") || t.includes("stable") || t.includes("release");
    });

    if (significantPRs.length === 0) return "This month saw steady progress with various improvements and bug fixes.";

    const updates = significantPRs.map(pr => `[${pr.title.replace(/^(feat|fix|chore|docs)(\(.*\))?:/i, '').trim()}](${pr.url})`).slice(0, 3);

    if (updates.length === 1) return `We are excited to highlight the introduction of ${updates[0]}.`;
    return `Highlights include ${updates.slice(0, -1).join(', ')} and ${updates.slice(-1)}.`;
  };

  // Build Body
  let body = `Here is the **WebMCP ${niceMonthName} Roundup**! 🚀\n\n`;

  if (prs.length > 0) {
    body += `${generateSummary(prs)}\n\n`;
  }

  body += `### PR Status\n`;
  if (prs.length > 0) {
    body += prs.map(formatBullet).join('\n');
  } else {
    body += `*No new activity in this month*`;
  }
  body += `\n\n`;

  body += `### Issues Status\n`;
  if (issues.length > 0) {
    body += issues.map(formatBullet).join('\n');
  } else {
    body += `*No new activity in this month*`;
  }
  body += `\n\n`;

  if (contributors.size > 0) {
    // Sort contributors broadly to ensure deterministic output
    const sortedContributors = Array.from(contributors.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const links = sortedContributors.map(([name, url]) => `[${name}](${url})`);
    body += `### 🌟 Contributors\nThanks to everyone who engaged this month: ${links.join(', ')}\n\n`;
  }

  body += `\n---\n*Auto-generated by WebMCP Newsletter Action*`;

  // Output
  if (process.env.DRY_RUN) {
    console.log("---------------------------------------------------");
    console.log("DRY RUN MODE ENABLED. Generated Body:");
    console.log("---------------------------------------------------");
    console.log(body);
    console.log("---------------------------------------------------");
    return;
  }

  // Post to Discussions
  const targetRepo = process.env.TARGET_REPOSITORY || process.env.GITHUB_REPOSITORY;
  const [currentOwner, currentRepo] = targetRepo.split("/");
  const { repository } = await graphqlWithAuth(`
    query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        id
        discussionCategories(first: 10) { nodes { id name } }
      }
    }
  `, { owner: currentOwner, repo: currentRepo });

  const repoId = repository.id;
  const categories = repository.discussionCategories.nodes;
  let category = categories.find(c => c.name.toLowerCase() === "announcements") || categories[0];

  if (!category) throw new Error("No discussion categories found.");

  console.log(`Posting to Category: ${category.name}`);

  const { createDiscussion } = await graphqlWithAuth(`
    mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
      createDiscussion(input: {repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body}) {
        discussion { url }
      }
    }
  `, {
    repositoryId: repoId,
    categoryId: category.id,
    title: `WebMCP ${niceMonthName} Roundup`,
    body: body
  });

  console.log(`Discussion created: ${createDiscussion.discussion.url}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
