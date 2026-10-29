import { getSettings } from "./github.js";
import { storageSet } from "./api.js";

const repoInput = document.getElementById("repo");
const branchInput = document.getElementById("branch");
const tokenInput = document.getElementById("token");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const openPopupBtn = document.getElementById("open-popup");

function normalizeBranch(value) {
  return String(value ?? "").trim() || "main";
}

async function load() {
  const settings = await getSettings();
  repoInput.value = settings.githubRepo || "";
  branchInput.value = settings.githubBranch || "main";
  tokenInput.value = settings.githubToken || "";
}

saveBtn.addEventListener("click", async () => {
  statusEl.textContent = "";
  const githubRepo = repoInput.value.trim();
  const githubBranch = normalizeBranch(branchInput.value);
  const githubToken = tokenInput.value.trim();

  if (!githubRepo) {
    statusEl.textContent = "Please enter a GitHub repository in owner/repo format.";
    return;
  }

  if (!githubToken) {
    statusEl.textContent = "Please enter a GitHub Personal Access Token.";
    return;
  }

  await storageSet({ githubRepo, githubBranch, githubToken });
  statusEl.textContent = "Settings saved.";
});

openPopupBtn.addEventListener("click", () => {
  window.close();
});

load().catch((error) => {
  statusEl.textContent = error?.message || String(error);
});
