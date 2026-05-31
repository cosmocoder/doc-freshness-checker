import fs from 'node:fs';

/**
 * Creates (or updates) the documentation-freshness tracking issue on scheduled runs.
 * Invoked from .github/workflows/doc-freshness.yml via actions/github-script.
 */
export default async ({ github, context }) => {
  const report = fs.readFileSync('.doc-freshness-reports/report.md', 'utf8');
  const json = JSON.parse(fs.readFileSync('.doc-freshness-reports/report.json', 'utf8'));

  const title = `📚 Documentation Freshness Issues - ${new Date().toISOString().split('T')[0]}`;
  const labels = ['documentation', 'automated'];

  // Search for existing open issue
  const { data: issues } = await github.rest.issues.listForRepo({
    owner: context.repo.owner,
    repo: context.repo.repo,
    labels: labels.join(','),
    state: 'open',
  });

  const existingIssue = issues.find((i) => i.title.includes('Documentation Freshness Issues'));

  const body = `# Documentation Freshness Report

**Run Date:** ${new Date().toISOString()}
**Errors:** ${json.summary.errors}
**Warnings:** ${json.summary.warnings}

${report}

---
*This issue is automatically updated by the doc-freshness workflow. Close this issue once all problems are resolved.*`;

  if (existingIssue) {
    await github.rest.issues.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: existingIssue.number,
      body,
    });
    console.log(`Updated issue #${existingIssue.number}`);
  }
  else {
    const { data: newIssue } = await github.rest.issues.create({
      owner: context.repo.owner,
      repo: context.repo.repo,
      title,
      body,
      labels,
    });
    console.log(`Created issue #${newIssue.number}`);
  }
};
