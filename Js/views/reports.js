// ============================================================
//  VIEWS/REPORTS.JS
//  Loads the latest light status report events.
//
//  Changed vs. the original reports.js: wrapped into mount()/show()/
//  hide(); polling starts/stops with visibility; cache read/write
//  now goes through services/cache.js (LWCache) instead of its own
//  inline localStorage helpers.
// ============================================================

(function () {
    const REPORTS_CACHE_KEY = 'lw_cache_reports_list';
    let reportsPollTimer = null;

    function renderReports(reports) {
        const reportList = document.querySelector('#view-reports .report-list');
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
              <span class="report-item__time">${LWHelpers.formatRelativeTimeFromDate(report.reportedAt)}</span>
            </article>
        `;
        }).join('');
    }

    function showReportLoading() {
        const reportList = document.querySelector('#view-reports .report-list');
        if (!reportList) return;
        reportList.classList.add('loading');
        reportList.innerHTML = Array.from({ length: 4 }).map(() => `
        <article class="report-item report-skeleton">
          <div style="height: 60px;"></div>
        </article>
    `).join('');
    }

    function loadReports(isFirstLoad = false) {
        const cached = isFirstLoad ? LWCache.read(REPORTS_CACHE_KEY, CACHE_MAX_AGE_SHORT_MS) : null;
        if (cached) {
            renderReports(cached);
        } else if (isFirstLoad) {
            showReportLoading();
        }

        fetch(`${API_URL}/reports?limit=30`)
            .then(r => r.json())
            .then(data => {
                const list = Array.isArray(data) ? data : [];
                renderReports(list);
                LWCache.write(REPORTS_CACHE_KEY, list);
            })
            .catch(err => {
                console.error('Could not load reports:', err);
                if (!cached) renderReports([]);
            });
    }

    function mount() {
        loadReports(true);
    }

    function show() {
        clearInterval(reportsPollTimer);
        reportsPollTimer = setInterval(() => loadReports(false), POLL_INTERVAL_FAST_MS);
    }

    function hide() {
        clearInterval(reportsPollTimer);
        reportsPollTimer = null;
    }

    window.LWViews = window.LWViews || {};
    window.LWViews.reports = { mount, show, hide };
})();
