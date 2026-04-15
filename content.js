// Inject "Thread Viewer" button into Slack's top navigation bar

function createThreadViewerButton() {
  if (document.getElementById('stv-open-btn')) return;

  // Find the help button as anchor
  const helpBtnContainer = document.querySelector('[data-qa="top-nav-help-button"]');
  if (!helpBtnContainer) return;

  const btn = document.createElement('button');
  btn.id = 'stv-open-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Thread Viewer');
  btn.title = 'Thread Viewer';
  // Match Slack's native button styling
  btn.style.cssText = `
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 4px;
    margin-right: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    opacity: 0.8;
  `;
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true" width="20" height="20"><path fill="currentColor" d="M2 4.5A2.5 2.5 0 0 1 4.5 2h7A2.5 2.5 0 0 1 14 4.5v1h1.5A2.5 2.5 0 0 1 18 8v7.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 15.5v-1H4.5A2.5 2.5 0 0 1 2 12V4.5ZM7.5 14v1.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H14v5a2.5 2.5 0 0 1-2.5 2.5h-4ZM4.5 3.5a1 1 0 0 0-1 1V12a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V4.5a1 1 0 0 0-1-1h-7ZM5 6.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 6.25ZM5.75 8.5a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z"/></svg>`;

  btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
  btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.8'; });
  btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
  });

  // Walk up from helpBtnContainer to find the top-level flex container
  let flexParent = helpBtnContainer;
  while (flexParent && !flexParent.classList.contains('display_flex')) {
    flexParent = flexParent.parentElement;
  }
  if (!flexParent) return;

  // Insert before the coachmark anchor (help button's ancestor)
  const coachmarkAnchor = flexParent.querySelector(':scope > .c-coachmark-anchor');
  if (coachmarkAnchor) {
    flexParent.insertBefore(btn, coachmarkAnchor);
  } else {
    flexParent.appendChild(btn);
  }
}

// Slack is a SPA - retry injection on DOM changes
function observeAndInject() {
  createThreadViewerButton();

  const observer = new MutationObserver(() => {
    if (!document.getElementById('stv-open-btn')) {
      createThreadViewerButton();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// Wait for Slack to finish rendering
if (document.readyState === 'complete') {
  observeAndInject();
} else {
  window.addEventListener('load', observeAndInject);
}
