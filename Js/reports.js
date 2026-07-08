// reports.js
// Loads the latest light status report events and renders them in
// the reports page, using the same profile/auth framework as the
// rest of the app.

function formatRelativeTime(dateStr) {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return mins === 1 ? '1m ago' : `${mins}m ago`;
    if (hours < 24) return hours === 1 ? '1h ago' : `${hours}h ago`;
    return days === 1 ? 'Yesterday' : `${days}d ago`;
}

function renderReports(reports) {
    const reportList = document.querySelector('.report-list');
    if (!reportList) return;
    reportList.classList.remove('loading');

    if (!reports || reports.length === 0) {
        reportList.innerHTML = '<article class="report-item report-item--info"><div><strong>No recent reports yet</strong><p class="report-item__text">Once users start sharing light updates, they will appear here.</p></div><span class="report-item__time">—</span></article>';
        return;
    }

    reportList.innerHTML = reports.map(report => {
        const statusClass = report.type === 'success' ? 'report-item--success' : report.type === 'warning' ? 'report-item--warning' : 'report-item--info';
        return `
            <article class="report-item ${statusClass}">
              <div>
                <strong>${report.title}</strong>
                <p class="report-item__text">${report.text}</p>
              </div>
              <span class="report-item__time">${formatRelativeTime(report.reportedAt)}</span>
            </article>
        `;
    }).join('');
}

function showReportLoading() {
    const reportList = document.querySelector('.report-list');
    if (!reportList) return;
    reportList.classList.add('loading');
    reportList.innerHTML = Array.from({ length: 4 }).map(() => `
        <article class="report-item report-skeleton">
          <div style="height: 60px;"></div>
        </article>
    `).join('');
}

function loadReports(showLoading = false) {
    if (showLoading) showReportLoading();
    fetch(`${API_URL}/reports?limit=30`)
        .then(r => r.json())
        .then(data => {
            renderReports(Array.isArray(data) ? data : []);
        })
        .catch(err => {
            console.error('Could not load reports:', err);
            renderReports([]);
        });
}

function runReportsPage() {
    loadReports(true);
    setInterval(() => loadReports(false), 30000);
}

runReportsPage();
