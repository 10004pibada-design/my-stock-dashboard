// ========================================
// Stock Dashboard - Main Application (DEBUG VERSION)
// ========================================

const AppState = {
    charts: {},
    chartMeta: {},
    autoRefreshInterval: null,
    autoRefreshEnabled: true,
    isLoadingStocks: false,
    pendingStockReload: false,
    currentTheme: localStorage.getItem('theme') || 'light',
    notificationsEnabled: false,
    wsConnected: false,
    selectedPeriod: localStorage.getItem('selectedPeriod') || '1y',
    searchLimit: Number(localStorage.getItem('searchLimit') || 10),
    debug: localStorage.getItem('debug') === 'true' || ['localhost', '127.0.0.1'].includes(window.location.hostname)
};

const CONFIG = {
    REFRESH_INTERVAL: 60000,
    ANIMATION_DURATION: 300,
    DEBOUNCE_DELAY: 300,
    MAX_RETRIES: 3,
    REQUEST_TIMEOUT: 15000
};

const VALID_PERIODS = ['5d', '1mo', '3mo', '6mo', '1y', '2y', '3y', '5y', 'max'];
const VALID_BACKTEST_PERIODS = ['6m', '1y', '2y', '3y'];
const VALID_SEARCH_LIMITS = [5, 10, 20, 50];

// Debug logger
function log(...args) {
    if (AppState.debug) {
        console.log('[StockDashboard]', ...args);
    }
}

function error(...args) {
    console.error('[StockDashboard]', ...args);
}

// ========================================
// Part 1: Core Utilities
// ========================================

const Utils = {
    formatNumber(num) {
        if (num === null || num === undefined || isNaN(num)) return '-';
        return new Intl.NumberFormat('ko-KR').format(Math.round(num));
    },
    
    formatPercent(num) {
        if (num === null || num === undefined || isNaN(num)) return '-';
        const sign = num > 0 ? '+' : '';
        return `${sign}${num.toFixed(2)}%`;
    },
    
    formatCurrency(num) {
        if (num === null || num === undefined || isNaN(num)) return '-';
        return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(Math.round(num));
    },
    
    debounce(fn, delay) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
        };
    },
    
    throttle(fn, limit) {
        let inThrottle;
        return (...args) => {
            if (!inThrottle) {
                fn(...args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
};

function normalizeStockPayload(payload, fallbackTicker = '') {
    if (!payload || typeof payload !== 'object') return null;

    const rawRsi = payload.rsi;
    const rsiSeries = Array.isArray(rawRsi) ? rawRsi : [];
    const latestRsi = payload.rsi_value ?? (rsiSeries.length ? rsiSeries[rsiSeries.length - 1] : null);

    const macdSeries = payload.macd?.macd;
    const latestMacd = Array.isArray(macdSeries) && macdSeries.length
        ? macdSeries[macdSeries.length - 1]
        : null;

    const normalizedOhlc = Array.isArray(payload.ohlc)
        ? payload.ohlc
        : (Array.isArray(payload.kline) && Array.isArray(payload.dates)
            ? payload.kline.map((candle, idx) => [payload.dates[idx], ...(Array.isArray(candle) ? candle : [])])
            : []);

    const normalizedVolume = Array.isArray(payload.volume)
        ? payload.volume
        : (Array.isArray(payload.volumes) ? payload.volumes : []);

    return {
        ...payload,
        ticker: payload.ticker || fallbackTicker,
        ohlc: normalizedOhlc,
        volume: normalizedVolume,
        rsi_value: latestRsi,
        macd_value: latestMacd
    };
}

// ========================================
// Part 2: API Client
// ========================================

const API = {
    baseUrl: '',
    
    async request(url, options = {}) {
        const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`;
        
        log('API Request:', fullUrl);
        
        const defaults = {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            credentials: 'same-origin'  // Important: include cookies for session
        };
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

        try {
            const response = await fetch(fullUrl, { ...defaults, ...options, signal: controller.signal });
            log('API Response status:', response.status, response.statusText);
            
            if (!response.ok) {
                const errorText = await response.text();
                error('API Error response:', errorText);

                let detail = '';
                try {
                    const parsed = JSON.parse(errorText || '{}');
                    detail = parsed.error || parsed.message || '';
                } catch (_e) {
                    detail = '';
                }

                const baseMessage = `HTTP ${response.status}: ${response.statusText}`;
                throw new Error(detail ? `${baseMessage} - ${detail}` : baseMessage);
            }
            
            const data = await response.json();
            log('API Response data:', data.success ? 'success' : 'failed');
            return data;
        } catch (err) {
            const message = err?.name === 'AbortError'
                ? `요청 시간이 초과되었습니다 (${CONFIG.REQUEST_TIMEOUT / 1000}초)`
                : err.message;
            error('API Error:', fullUrl, message);
            throw new Error(message);
        } finally {
            clearTimeout(timeoutId);
        }
    },
    
    get(url) { 
        log('API GET:', url);
        return this.request(url, { method: 'GET' }); 
    },
    
    post(url, data) { 
        log('API POST:', url, data);
        return this.request(url, { method: 'POST', body: JSON.stringify(data) }); 
    },
    
    put(url, data) { 
        return this.request(url, { method: 'PUT', body: JSON.stringify(data) }); 
    },
    
    delete(url, data = null) {
        const options = { method: 'DELETE' };
        if (data !== null && data !== undefined) {
            options.body = JSON.stringify(data);
        }
        return this.request(url, options);
    },

    async getStockData(ticker, period = AppState.selectedPeriod) {
        if (!ticker) return null;
        const safePeriod = VALID_PERIODS.includes(period) ? period : '1y';
        try {
            const response = await this.get(`/api/stock/${ticker}?period=${encodeURIComponent(safePeriod)}`);
            if (!response.success || !response.data) return null;
            return normalizeStockPayload(response.data, ticker);
        } catch (err) {
            error('Failed to get stock data for', ticker, err);
            return null;
        }
    },
    
    async searchStocks(query, limit = AppState.searchLimit) {
        if (!query || query.length < 2) return [];
        const safeLimit = VALID_SEARCH_LIMITS.includes(Number(limit)) ? Number(limit) : 10;
        try {
            const data = await this.get(`/api/search?q=${encodeURIComponent(query)}&limit=${safeLimit}`);
            return data.success ? data.results || [] : [];
        } catch (err) {
            error('Search failed:', err);
            return [];
        }
    },

    async addMainTicker(ticker, name = '') {
        return this.post('/api/tickers', { ticker, name });
    },

    async deleteMainTicker(name) {
        return this.delete('/api/tickers', { name });
    }
};

// ========================================
// Part 3: Notification System
// ========================================

const Notification = {
    container: null,
    
    init() {
        this.container = document.getElementById('toastContainer');
        if (!this.container) {
            log('Creating toast container');
            this.container = document.createElement('div');
            this.container.id = 'toastContainer';
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    },
    
    toast(title, message, type = 'info') {
        if (!this.container) this.init();
        
        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <i class="fas ${icons[type] || icons.info}"></i>
            <div class="toast-content">
                <strong>${title}</strong>
                <span>${message}</span>
            </div>
        `;
        
        this.container.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
};

// ========================================
// Part 4: Chart Renderer
// ========================================

const ChartRenderer = {
    resizeHandlerBound: false,

    _bindResizeHandler() {
        if (this.resizeHandlerBound) return;
        const onResize = Utils.throttle(() => {
            Object.values(AppState.charts).forEach(chart => {
                if (chart && typeof chart.resize === 'function') {
                    chart.resize();
                }
            });
        }, 200);
        window.addEventListener('resize', onResize);
        this.resizeHandlerBound = true;
    },

    render(chartId, data, name) {
        log('Rendering chart:', chartId, 'data exists:', !!data);
        
        const container = document.getElementById(chartId);
        if (!container) {
            error('Chart container not found:', chartId);
            return;
        }
        
        const normalized = normalizeStockPayload(data);
        if (!normalized || !normalized.ohlc || normalized.ohlc.length === 0) {
            error('No data for chart:', chartId, 'data:', data);
            container.innerHTML = '<div class="chart-error">데이터 없음</div>';
            return;
        }
        
        // Dispose existing chart
        if (AppState.charts[chartId]) {
            try {
                AppState.charts[chartId].dispose();
            } catch (e) {
                error('Error disposing chart:', e);
            }
            delete AppState.charts[chartId];
        }
        
        // Check if ECharts is available
        if (typeof echarts === 'undefined') {
            error('ECharts not loaded');
            container.innerHTML = '<div class="chart-error">차트 라이브러리 로딩 실패</div>';
            return;
        }
        
        try {
            const chart = echarts.init(container, AppState.currentTheme === 'dark' ? 'dark' : null);
            AppState.charts[chartId] = chart;
            AppState.chartMeta[chartId] = { data: normalized, name };
            
            const dates = normalized.ohlc.map(d => d[0]);
            const prices = normalized.ohlc.map(d => d.slice(1));
            const volumes = normalized.volume || [];
            
            log('Chart data points:', dates.length);
            
            const option = {
                animation: true,
                backgroundColor: 'transparent',
                title: {
                    text: name,
                    left: 'center',
                    textStyle: { fontSize: 14 }
                },
                tooltip: {
                    trigger: 'axis',
                    axisPointer: { type: 'cross' }
                },
                legend: { top: 'bottom' },
                grid: [
                    { left: '10%', right: '8%', height: '55%' },
                    { left: '10%', right: '8%', top: '68%', height: '16%' }
                ],
                xAxis: [
                    {
                        type: 'category',
                        data: dates,
                        scale: true,
                        boundaryGap: false,
                        axisLine: { onZero: false },
                        splitLine: { show: false },
                        axisLabel: { show: false }
                    },
                    {
                        type: 'category',
                        gridIndex: 1,
                        data: dates,
                        axisLabel: { show: true }
                    }
                ],
                yAxis: [
                    {
                        scale: true,
                        splitArea: { show: true }
                    },
                    {
                        scale: true,
                        gridIndex: 1,
                        splitNumber: 2,
                        axisLabel: { show: false },
                        axisLine: { show: false },
                        axisTick: { show: false },
                        splitLine: { show: false }
                    }
                ],
                dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], start: 50, end: 100 }],
                series: [
                    {
                        name: 'Price',
                        type: 'candlestick',
                        data: prices,
                        itemStyle: {
                            color: '#ef4444',
                            color0: '#3b82f6',
                            borderColor: '#ef4444',
                            borderColor0: '#3b82f6'
                        }
                    },
                    {
                        name: 'MA20',
                        type: 'line',
                        data: normalized.ma20 || [],
                        smooth: true,
                        lineStyle: { opacity: 0.5 },
                        symbol: 'none'
                    },
                    {
                        name: 'MA60',
                        type: 'line',
                        data: normalized.ma60 || [],
                        smooth: true,
                        lineStyle: { opacity: 0.5 },
                        symbol: 'none'
                    },
                    {
                        name: 'Volume',
                        type: 'bar',
                        xAxisIndex: 1,
                        yAxisIndex: 1,
                        data: volumes,
                        itemStyle: { color: '#93c5fd' }
                    }
                ]
            };
            
            chart.setOption(option);
            this._bindResizeHandler();
            
            log('Chart rendered successfully:', chartId);
        } catch (err) {
            error('Chart render error:', err);
            container.innerHTML = '<div class="chart-error">차트 렌더링 오류</div>';
        }
    },
    
    updateTheme() {
        const snapshots = Object.entries(AppState.chartMeta);

        Object.keys(AppState.charts).forEach(key => {
            const chart = AppState.charts[key];
            if (chart) {
                chart.dispose();
            }
            delete AppState.charts[key];
        });

        snapshots.forEach(([chartId, meta]) => {
            if (meta && document.getElementById(chartId)) {
                this.render(chartId, meta.data, meta.name);
            }
        });
    }
};

// ========================================
// Part 5: Stock Card Component
// ========================================

const StockCard = {
    create(cardId, chartId, data, ticker, removable = false) {
        log('Creating stock card:', cardId, 'for', ticker);

        const signalClass = data.signal_class || 'neutral';
        const changeClass = (data.change_pct || 0) >= 0 ? 'positive' : 'negative';
        const changeIcon = (data.change_pct || 0) >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';

        const safeTicker = String(ticker || '').replace(/'/g, "\\'");
        const safeNameKey = String(data.name_key || data.name || ticker || '').replace(/'/g, "\\'");
        const canRemoveMain = Boolean(!removable && data.is_user_added && safeNameKey);

        const removeButtonHtml = removable
            ? `<button class="btn-remove" onclick="CustomChartsManager.removeCustomChart('${safeTicker}')" title="삭제"><i class="fas fa-times"></i></button>`
            : canRemoveMain
                ? `<button class="btn-remove main-remove" onclick="MainStocksManager.removeMainTicker('${safeNameKey}', '${safeTicker}')" title="메인 종목 삭제"><i class="fas fa-trash"></i></button>`
                : '';

        const div = document.createElement('div');
        div.id = cardId;
        div.className = 'stock-card';
        div.innerHTML = `
            <div class="stock-header">
                <div class="stock-title-wrap">
                    <h4>${data.name || ticker}</h4>
                    <span class="stock-code">${ticker}</span>
                </div>
                <div class="stock-header-right">
                    <span class="signal-badge ${signalClass}">${data.signal_text || '분석중'}</span>
                    ${removeButtonHtml}
                </div>
            </div>
            <div class="stock-info-top">
                <div class="stock-info-block">
                    <span class="stock-info-label">현재가</span>
                    <span class="current-price">${Utils.formatNumber(data.latest_price)}원</span>
                </div>
                <div class="stock-info-block">
                    <span class="stock-info-label">등락률</span>
                    <span class="change-pct ${changeClass}">
                        <i class="fas ${changeIcon}"></i> ${Utils.formatPercent(data.change_pct)}
                    </span>
                </div>
            </div>
            <div class="stock-chart">
                <div id="${chartId}" style="width:100%; height:300px;"></div>
            </div>
            <div class="stock-metrics">
                <div class="metric">
                    <span class="label">RSI(14)</span>
                    <span class="value ${this._getRsiClass(data.rsi_value)}">${data.rsi_value !== null && data.rsi_value !== undefined ? Number(data.rsi_value).toFixed(2) : '-'}</span>
                </div>
                <div class="metric">
                    <span class="label">MACD</span>
                    <span class="value">${data.macd_value !== null && data.macd_value !== undefined ? Number(data.macd_value).toFixed(2) : '-'}</span>
                </div>
                <div class="metric">
                    <span class="label">최근 거래량</span>
                    <span class="value">${Array.isArray(data.volume) && data.volume.length > 0 ? Utils.formatNumber(data.volume[data.volume.length - 1]) : '-'}</span>
                </div>
            </div>
        `;
        return div;
    },
    
    _getRsiClass(rsi) {
        if (rsi === null || rsi === undefined || Number.isNaN(Number(rsi))) return '';
        const value = Number(rsi);
        if (value > 70) return 'overbought';
        if (value < 30) return 'oversold';
        return '';
    }
};

// ========================================
// Part 6: Tab Manager
// ========================================

const TabManager = {
    initialized: false,
    
    init() {
        if (this.initialized) return;
        
        const tabBtns = document.querySelectorAll('.tab-btn');
        log('TabManager: Found', tabBtns.length, 'tab buttons');
        
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e));
        });
        
        this.initialized = true;
    },
    
    switchTab(e) {
        const tabId = e.currentTarget.dataset.tab;
        if (!tabId) {
            error('No tab ID found');
            return;
        }
        
        log('Switching to tab:', tabId);
        
        // Update button states
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        e.currentTarget.classList.add('active');
        
        // Update content visibility
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        
        const targetContent = document.getElementById(`${tabId}Tab`);
        if (targetContent) {
            targetContent.classList.add('active');
            log('Activated tab content:', `${tabId}Tab`);
        } else {
            error('Tab content not found:', `${tabId}Tab`);
        }
        
        // Load portfolio data when switching to portfolio tab
        if (tabId === 'portfolio' && typeof PortfolioManager !== 'undefined') {
            PortfolioManager.loadPortfolio();
        }
    }
};

// ========================================
// Part 7: Portfolio Manager
// ========================================

const PortfolioManager = {
    initialized: false,
    
    init() {
        if (this.initialized) return;
        
        const addBtn = document.getElementById('addPortfolioBtn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.addHolding());
        }
        
        this.initialized = true;
        log('PortfolioManager initialized');
    },
    
    async addHolding() {
        const ticker = document.getElementById('portfolioTicker')?.value?.trim();
        const name = document.getElementById('portfolioName')?.value?.trim();
        const shares = parseFloat(document.getElementById('portfolioShares')?.value);
        const avgPrice = parseFloat(document.getElementById('portfolioPrice')?.value);
        
        if (!ticker || !name || !shares || !avgPrice) {
            Notification.toast('오류', '모든 필드를 입력해주세요.', 'error');
            return;
        }
        
        try {
            const result = await API.post('/api/portfolio', {
                ticker, name, shares, avg_price: avgPrice
            });
            
            if (result.success) {
                Notification.toast('성공', '종목이 추가되었습니다.', 'success');
                this.loadPortfolio();
                // Clear inputs
                ['portfolioTicker', 'portfolioName', 'portfolioShares', 'portfolioPrice'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = '';
                });
            } else {
                Notification.toast('오류', result.error || '추가 실패', 'error');
            }
        } catch (err) {
            error('Failed to add holding:', err);
            Notification.toast('오류', '서버 연결 실패', 'error');
        }
    },
    
    async loadPortfolio() {
        try {
            const result = await API.get('/api/portfolio');
            if (result.success) {
                this.renderPortfolio(result.data);
            }
        } catch (err) {
            error('Failed to load portfolio:', err);
        }
    },
    
    renderPortfolio(data) {
        const tbody = document.getElementById('portfolioTableBody');
        if (!tbody) return;
        
        const summary = data?.summary || {};
        const holdings = data?.holdings || [];
        
        // Update summary
        const totalInvested = document.getElementById('totalInvested');
        const currentValue = document.getElementById('currentValue');
        const totalReturn = document.getElementById('totalReturn');
        
        if (totalInvested) totalInvested.textContent = Utils.formatCurrency(summary.total_invested || 0);
        if (currentValue) currentValue.textContent = Utils.formatCurrency(summary.current_value || 0);
        if (totalReturn) {
            const returnPct = summary.return_pct ?? summary.total_return_pct ?? 0;
            totalReturn.textContent = Utils.formatPercent(returnPct);
            totalReturn.className = `value ${returnPct >= 0 ? 'positive' : 'negative'}`;
        }
        
        // Render holdings
        if (holdings.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="8">보유 종목이 없습니다.</td></tr>';
            return;
        }
        
        tbody.innerHTML = holdings.map(h => {
            const returnPct = h.return_pct ?? 0;
            const returnAmount = h.return_amount ?? h.profit_loss ?? 0;
            const returnClass = returnPct >= 0 ? 'positive' : 'negative';
            return `
                <tr>
                    <td>${h.name}</td>
                    <td>${h.shares}</td>
                    <td>${Utils.formatNumber(h.avg_price)}</td>
                    <td>${Utils.formatNumber(h.current_price)}</td>
                    <td>${Utils.formatNumber(h.current_value)}</td>
                    <td class="${returnClass}">${Utils.formatNumber(returnAmount)}</td>
                    <td class="${returnClass}">${Utils.formatPercent(returnPct)}</td>
                    <td>
                        <button class="btn-icon" onclick="PortfolioManager.deleteHolding('${h.id}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },
    
    async deleteHolding(id) {
        if (!confirm('정말 삭제하시겠습니까?')) return;
        
        try {
            const result = await API.delete(`/api/portfolio/${id}`);
            if (result.success) {
                Notification.toast('성공', '삭제되었습니다.', 'success');
                this.loadPortfolio();
            }
        } catch (err) {
            error('Failed to delete holding:', err);
            Notification.toast('오류', '삭제 실패', 'error');
        }
    }
};

// ========================================
// Part 8: Backtest Manager
// ========================================

const BacktestManager = {
    initialized: false,
    chart: null,
    lastEquityData: [],

    mapGlobalPeriodToBacktest(period) {
        const periodMap = {
            '5d': '6m',
            '1mo': '6m',
            '3mo': '6m',
            '6mo': '6m',
            '1y': '1y',
            '2y': '2y',
            '3y': '3y',
            '5y': '3y',
            'max': '3y'
        };
        return periodMap[period] || '1y';
    },

    syncPeriodFromGlobal(globalPeriod) {
        const select = document.getElementById('backtestPeriod');
        if (!select) return;

        const backtestPeriod = this.mapGlobalPeriodToBacktest(globalPeriod);
        if (VALID_BACKTEST_PERIODS.includes(backtestPeriod)) {
            select.value = backtestPeriod;
        }
    },

    refreshChartTheme() {
        if (Array.isArray(this.lastEquityData) && this.lastEquityData.length > 0) {
            this.renderEquityChart(this.lastEquityData);
        }
    },
    
    init() {
        if (this.initialized) return;
        
        const btn = document.getElementById('runBacktestBtn');
        if (btn) {
            btn.addEventListener('click', () => this.runBacktest());
        }
        
        this.initialized = true;
        log('BacktestManager initialized');
    },
    
    async runBacktest() {
        const ticker = document.getElementById('backtestTicker')?.value?.trim() || '005930.KS';
        const period = document.getElementById('backtestPeriod')?.value || '1y';
        
        const btn = document.getElementById('runBacktestBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 실행중...';
        }
        
        try {
            const result = await API.get(`/api/backtest/${ticker}?period=${period}`);
            
            if (result.success && result.data) {
                this.renderResults(result.data);
                Notification.toast('성공', '백테스팅 완료', 'success');
            } else {
                Notification.toast('오류', result.error || '백테스팅 실패', 'error');
            }
        } catch (err) {
            error('Backtest error:', err);
            Notification.toast('오류', '백테스팅 오류', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-play"></i> 백테스트 실행';
            }
        }
    },
    
    renderResults(data) {
        const resultsContainer = document.getElementById('backtestResults');
        if (resultsContainer) {
            resultsContainer.style.display = 'block';
        }
        
        // Render summary
        const summary = document.getElementById('backtestSummary');
        if (summary) {
            const totalReturn = data.total_return_pct ?? data.total_return ?? 0;
            const winRate = data.win_rate ?? 0;
            const totalTrades = data.total_trades ?? 0;
            summary.innerHTML = `
                <h4 class="backtest-summary-title">백테스팅 결과 요약</h4>
                <div class="summary-grid">
                    <div class="backtest-summary-item">
                        <span class="label">총 수익률</span>
                        <span class="value ${totalReturn >= 0 ? 'positive' : 'negative'}">${Utils.formatPercent(totalReturn)}</span>
                    </div>
                    <div class="backtest-summary-item">
                        <span class="label">승률</span>
                        <span class="value">${Number(winRate).toFixed(1)}%</span>
                    </div>
                    <div class="backtest-summary-item">
                        <span class="label">거래 횟수</span>
                        <span class="value">${totalTrades}회</span>
                    </div>
                </div>
            `;
        }
        
        // Render trades table
        const tbody = document.getElementById('tradesTableBody');
        if (tbody && Array.isArray(data.trades)) {
            tbody.innerHTML = data.trades.map(t => {
                const tradeReturnPct = t.return_pct ?? t.profit_pct ?? 0;
                const tradeReturnAmount = t.return_amount ?? t.profit ?? 0;
                const returnClass = tradeReturnPct >= 0 ? 'positive' : 'negative';
                return `
                    <tr>
                        <td>${t.entry_date || '-'}</td>
                        <td>${Utils.formatNumber(t.entry_price)}</td>
                        <td>${t.exit_date || '-'}</td>
                        <td>${Utils.formatNumber(t.exit_price)}</td>
                        <td class="${returnClass}">${Utils.formatNumber(tradeReturnAmount)}</td>
                        <td class="${returnClass}">${Utils.formatPercent(tradeReturnPct)}</td>
                    </tr>
                `;
            }).join('');
        }

        // Render equity chart
        this.lastEquityData = Array.isArray(data.equity_curve) ? data.equity_curve : [];
        this.renderEquityChart(this.lastEquityData);
    },
    
    renderEquityChart(equityData) {
        const chartEl = document.getElementById('backtestChart');
        if (!equityData || !chartEl) return;

        if (typeof echarts === 'undefined') {
            error('ECharts not available for equity chart');
            return;
        }

        if (this.chart) {
            try {
                this.chart.dispose();
            } catch (e) {
                error('Failed to dispose backtest chart:', e);
            }
            this.chart = null;
        }

        this.chart = echarts.init(chartEl, AppState.currentTheme === 'dark' ? 'dark' : null);
        const option = {
            title: { text: '자본금 변화', left: 'center' },
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: equityData.map(d => d.date) },
            yAxis: { type: 'value' },
            series: [{
                data: equityData.map(d => d.value ?? d.equity),
                type: 'line',
                smooth: true,
                areaStyle: { opacity: 0.3 }
            }]
        };
        this.chart.setOption(option);
    }
};

// ========================================
// Part 9: Search Manager
// ========================================

const SearchManager = {
    initialized: false,
    
    init() {
        if (this.initialized) return;
        
        const searchBtn = document.getElementById('searchBtn');
        const searchInput = document.getElementById('stockSearch');
        const limitSelect = document.getElementById('searchLimitSelect');

        if (limitSelect) {
            const safeLimit = VALID_SEARCH_LIMITS.includes(Number(AppState.searchLimit))
                ? Number(AppState.searchLimit)
                : 10;
            AppState.searchLimit = safeLimit;
            limitSelect.value = String(safeLimit);

            limitSelect.addEventListener('change', () => {
                const nextLimit = Number(limitSelect.value);
                AppState.searchLimit = VALID_SEARCH_LIMITS.includes(nextLimit) ? nextLimit : 10;
                localStorage.setItem('searchLimit', String(AppState.searchLimit));
                log('Search limit changed:', AppState.searchLimit);
            });
        }
        
        if (searchBtn) {
            searchBtn.addEventListener('click', () => this.performSearch());
        }
        
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.performSearch();
            });
        }
        
        // Quick add chips
        document.querySelectorAll('.quick-add .chip, .quick-add-chips .chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const code = chip.dataset.code;
                if (code && typeof CustomChartsManager !== 'undefined') {
                    CustomChartsManager.addStock(code);
                }
            });
        });
        
        this.initialized = true;
        log('SearchManager initialized');
    },
    
    async performSearch() {
        const query = document.getElementById('stockSearch')?.value?.trim();
        if (!query || query.length < 2) {
            Notification.toast('알림', '2글자 이상 입력해주세요.', 'warning');
            const resultsDiv = document.getElementById('searchResults');
            if (resultsDiv) {
                resultsDiv.classList.remove('visible');
                resultsDiv.innerHTML = '';
            }
            return;
        }
        
        const resultsDiv = document.getElementById('searchResults');
        if (resultsDiv) {
            resultsDiv.classList.add('visible');
            resultsDiv.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> 검색중...</div>';
        }
        
        try {
            const results = await API.searchStocks(query, AppState.searchLimit);
            this.displayResults(results);
        } catch (err) {
            error('Search failed:', err);
            if (resultsDiv) {
                resultsDiv.innerHTML = '<div class="error">검색 실패</div>';
            }
        }
    },
    
    displayResults(results) {
        const resultsDiv = document.getElementById('searchResults');
        if (!resultsDiv) return;
        
        if (!results || results.length === 0) {
            resultsDiv.classList.add('visible');
            resultsDiv.innerHTML = '<div class="no-results">결과 없음</div>';
            return;
        }
        
        resultsDiv.classList.add('visible');
        
        resultsDiv.innerHTML = results.map(r => `
            <div class="search-result-item" onclick="SearchManager.addStock('${r.name}', '${r.ticker}')">
                <span class="stock-name">${r.name}</span>
                <span class="stock-code">${r.ticker}</span>
                <span class="market-badge">${r.market}</span>
            </div>
        `).join('');
    },
    
    async addStock(name, ticker) {
        if (typeof CustomChartsManager !== 'undefined') {
            await CustomChartsManager.addStock(ticker);
        }
        const resultsDiv = document.getElementById('searchResults');
        if (resultsDiv) {
            resultsDiv.classList.remove('visible');
            resultsDiv.innerHTML = '';
        }
    }
};

// ========================================
// Part 10: Custom Charts Manager
// ========================================

const CustomChartsManager = {
    initialized: false,
    
    init() {
        if (this.initialized) return;
        
        const addBtn = document.getElementById('addCustomChartBtn');
        const input = document.getElementById('customTickerInput');
        
        if (addBtn) {
            addBtn.addEventListener('click', () => this.addCustomChart());
        }
        
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.addCustomChart();
            });
        }
        
        // Load saved charts
        this.loadSavedCharts();
        
        this.initialized = true;
        log('CustomChartsManager initialized');
    },
    
    async addCustomChart() {
        const input = document.getElementById('customTickerInput');
        const ticker = input?.value?.trim();
        
        if (!ticker) {
            Notification.toast('오류', '종목코드를 입력해주세요.', 'error');
            return;
        }
        
        await this.addStock(ticker);
        if (input) input.value = '';
    },
    
    async addStock(ticker) {
        log('Adding stock:', ticker);
        
        try {
            Notification.toast('정보', '데이터 로딩중...', 'info');
            
            const data = await API.getStockData(ticker);
            if (data) {
                this.addStockCard(ticker, data);
                this.saveToLocalStorage(ticker);
                Notification.toast('성공', `${data.name || ticker} 추가됨`, 'success');
            } else {
                Notification.toast('오류', '종목을 찾을 수 없습니다.', 'error');
            }
        } catch (err) {
            error('Failed to add custom chart:', err);
            Notification.toast('오류', '데이터 로딩 실패', 'error');
        }
    },
    
    addStockCard(ticker, data) {
        const container = document.getElementById('customStocksGrid');
        if (!container) {
            error('Custom stocks grid not found');
            return;
        }
        
        const emptyState = document.getElementById('emptyCustomCharts');
        if (emptyState) {
            emptyState.style.display = 'none';
        }
        
        const safeTicker = ticker.replace(/\./g, '_');
        const cardId = `custom-card-${safeTicker}`;
        const chartId = `chart-custom-${safeTicker}`;
        
        // Check for duplicates
        if (document.getElementById(cardId)) {
            Notification.toast('알림', '이미 추가된 종목입니다.', 'warning');
            return;
        }
        
        const card = StockCard.create(cardId, chartId, data, ticker, true);
        container.appendChild(card);
        
        // Render chart after DOM update
        setTimeout(() => {
            const chartContainer = document.getElementById(chartId);
            if (chartContainer) {
                ChartRenderer.render(chartId, data, data.name || ticker);
            }
        }, 100);
    },
    
    removeCustomChart(ticker) {
        const safeTicker = ticker.replace(/\./g, '_');
        const cardId = `custom-card-${safeTicker}`;
        const chartId = `chart-custom-${safeTicker}`;
        
        // Dispose chart
        if (AppState.charts[chartId]) {
            try {
                AppState.charts[chartId].dispose();
            } catch (e) {
                error('Error disposing chart:', e);
            }
            delete AppState.charts[chartId];
        }
        delete AppState.chartMeta[chartId];
        
        // Remove card
        const card = document.getElementById(cardId);
        if (card) {
            card.remove();
        }
        
        // Update local storage
        this.removeFromLocalStorage(ticker);
        
        // Show empty state if no cards left
        const container = document.getElementById('customStocksGrid');
        const emptyState = document.getElementById('emptyCustomCharts');
        if (container && emptyState) {
            const cards = container.querySelectorAll('.stock-card');
            if (cards.length === 0) {
                emptyState.style.display = 'block';
            }
        }
        
        Notification.toast('성공', '차트가 삭제되었습니다.', 'success');
    },
    
    saveToLocalStorage(ticker) {
        try {
            const saved = JSON.parse(localStorage.getItem('customCharts') || '[]');
            if (!saved.includes(ticker)) {
                saved.push(ticker);
                localStorage.setItem('customCharts', JSON.stringify(saved));
            }
        } catch (e) {
            error('LocalStorage error:', e);
        }
    },
    
    removeFromLocalStorage(ticker) {
        try {
            const saved = JSON.parse(localStorage.getItem('customCharts') || '[]');
            const index = saved.indexOf(ticker);
            if (index > -1) {
                saved.splice(index, 1);
                localStorage.setItem('customCharts', JSON.stringify(saved));
            }
        } catch (e) {
            error('LocalStorage error:', e);
        }
    },
    
    async loadSavedCharts() {
        return this.reloadAllCharts();
    },

    async reloadAllCharts() {
        const container = document.getElementById('customStocksGrid');
        const emptyState = document.getElementById('emptyCustomCharts');

        if (container) {
            Array.from(container.querySelectorAll('.stock-card')).forEach(card => card.remove());
        }

        // 기존 커스텀 차트 인스턴스 정리
        Object.keys(AppState.charts)
            .filter(key => key.startsWith('chart-custom-'))
            .forEach(key => {
                try {
                    AppState.charts[key]?.dispose();
                } catch (e) {
                    error('Failed to dispose custom chart:', key, e);
                }
                delete AppState.charts[key];
                delete AppState.chartMeta[key];
            });

        try {
            const saved = JSON.parse(localStorage.getItem('customCharts') || '[]');
            log('Reloading saved charts with period:', AppState.selectedPeriod, saved);

            if (!Array.isArray(saved) || saved.length === 0) {
                if (emptyState) emptyState.style.display = 'block';
                return;
            }

            if (emptyState) emptyState.style.display = 'none';

            for (const ticker of saved) {
                try {
                    const data = await API.getStockData(ticker, AppState.selectedPeriod);
                    if (data) {
                        this.addStockCard(ticker, data);
                    }
                } catch (err) {
                    error(`Failed to load chart for ${ticker}:`, err);
                }
            }
        } catch (e) {
            error('Error loading saved charts:', e);
            if (emptyState) emptyState.style.display = 'block';
        }
    }
};

// ========================================
// Part 11: Settings Manager
// ========================================

const SettingsManager = {
    initialized: false,
    
    init() {
        if (this.initialized) return;
        
        const themeBtn = document.getElementById('themeToggle');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => this.toggleTheme());
        }
        
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                Notification.toast('정보', '새로고침중...', 'info');
                App.loadStocks();
            });
        }
        
        // Apply initial theme
        this.applyTheme();
        
        this.initialized = true;
        log('SettingsManager initialized');
    },
    
    toggleTheme() {
        AppState.currentTheme = AppState.currentTheme === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', AppState.currentTheme);
        this.applyTheme();
        Notification.toast('테마', AppState.currentTheme === 'light' ? '라이트 모드' : '다크 모드', 'info');
    },
    
    applyTheme() {
        document.documentElement.setAttribute('data-theme', AppState.currentTheme);
        ChartRenderer.updateTheme();
        BacktestManager.refreshChartTheme();
    }
};

// ========================================
// Part 12: Main Stocks Manager
// ========================================

const MainStocksManager = {
    initialized: false,

    init() {
        if (this.initialized) return;

        const addBtn = document.getElementById('addMainTickerBtn');
        const input = document.getElementById('mainTickerInput');

        if (addBtn) {
            addBtn.addEventListener('click', () => this.addMainTicker());
        }

        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.addMainTicker();
            });
        }

        this.initialized = true;
        log('MainStocksManager initialized');
    },

    async addMainTicker() {
        const input = document.getElementById('mainTickerInput');
        const addBtn = document.getElementById('addMainTickerBtn');
        const rawTicker = input?.value?.trim();

        if (!rawTicker) {
            Notification.toast('오류', '메인 종목 코드를 입력해주세요.', 'error');
            return;
        }

        if (addBtn) {
            addBtn.disabled = true;
            addBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 추가중...';
        }

        try {
            const result = await API.addMainTicker(rawTicker);
            if (!result?.success) {
                Notification.toast('오류', result?.error || '메인 종목 추가 실패', 'error');
                return;
            }

            Notification.toast('성공', `${result.name || result.ticker} 메인 종목 추가 완료`, 'success');
            if (input) input.value = '';
            await App.loadStocks(true);
        } catch (err) {
            error('Failed to add main ticker:', err);
            Notification.toast('오류', err.message || '메인 종목 추가 실패', 'error');
        } finally {
            if (addBtn) {
                addBtn.disabled = false;
                addBtn.innerHTML = '<i class="fas fa-plus"></i> 메인 추가';
            }
        }
    },

    async removeMainTicker(name, ticker = '') {
        if (!name) {
            Notification.toast('오류', '삭제할 메인 종목 정보를 찾을 수 없습니다.', 'error');
            return;
        }

        const display = ticker ? `${name} (${ticker})` : name;
        if (!confirm(`${display} 종목을 메인 목록에서 삭제하시겠습니까?`)) {
            return;
        }

        try {
            const result = await API.deleteMainTicker(name);
            if (!result?.success) {
                Notification.toast('오류', result?.error || '메인 종목 삭제 실패', 'error');
                return;
            }

            Notification.toast('성공', result.message || '메인 종목이 삭제되었습니다.', 'success');
            await App.loadStocks(true);
        } catch (err) {
            error('Failed to remove main ticker:', err);
            Notification.toast('오류', err.message || '메인 종목 삭제 실패', 'error');
        }
    }
};

// ========================================
// Part 13: Main App Controller
// ========================================

const App = {
    async init() {
        log('App initializing...');

        this.initQueryControls();
        BacktestManager.syncPeriodFromGlobal(AppState.selectedPeriod);
        
        try {
            await this.loadStocks();
            await this.updateMarketStatus();
            this.startAutoRefresh();
            
            log('App initialized successfully');
        } catch (err) {
            error('App initialization error:', err);
        }
    },

    initQueryControls() {
        const periodSelect = document.getElementById('globalPeriodSelect');
        if (!periodSelect) return;

        const safePeriod = VALID_PERIODS.includes(AppState.selectedPeriod) ? AppState.selectedPeriod : '1y';
        AppState.selectedPeriod = safePeriod;
        periodSelect.value = safePeriod;

        periodSelect.addEventListener('change', async () => {
            const nextPeriod = periodSelect.value;
            AppState.selectedPeriod = VALID_PERIODS.includes(nextPeriod) ? nextPeriod : '1y';
            localStorage.setItem('selectedPeriod', AppState.selectedPeriod);
            BacktestManager.syncPeriodFromGlobal(AppState.selectedPeriod);
            Notification.toast('정보', `차트 기간이 ${AppState.selectedPeriod}로 변경되었습니다.`, 'info');

            await this.loadStocks(true);
            if (typeof CustomChartsManager !== 'undefined') {
                await CustomChartsManager.reloadAllCharts();
            }
        });
    },
    
    async loadStocks(force = false) {
        if (AppState.isLoadingStocks) {
            if (force) {
                AppState.pendingStockReload = true;
            }
            log('Skip loadStocks: previous request still in progress');
            return;
        }

        log('Loading stocks...');

        const grid = document.getElementById('mainStocksGrid');
        if (!grid) {
            error('Main stocks grid not found');
            return;
        }

        AppState.isLoadingStocks = true;

        // Show loading
        grid.innerHTML = `
            <div class="loading-skeleton">
                <div class="skeleton-card"></div>
                <div class="skeleton-card"></div>
            </div>
        `;

        try {
            log('Calling API.get for /api/stocks with period:', AppState.selectedPeriod);
            const result = await API.get(`/api/stocks?period=${encodeURIComponent(AppState.selectedPeriod)}`);
            log('API response received:', result);

            if (result.success && result.data) {
                log('Rendering stocks, count:', Object.keys(result.data).length);
                this.renderStocks(result.data);
                this.updateLastUpdateTime();
            } else {
                error('API returned failure:', result);
                grid.innerHTML = '<div class="error-state">데이터를 불러올 수 없습니다.</div>';
            }
        } catch (err) {
            error('Failed to load stocks:', err);
            grid.innerHTML = `
                <div class="error-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>서버 연결 실패</p>
                    <small>${err.message}</small>
                </div>
            `;
            Notification.toast('오류', `데이터 로딩 실패: ${err.message}`, 'error');
        } finally {
            AppState.isLoadingStocks = false;
            if (AppState.pendingStockReload) {
                AppState.pendingStockReload = false;
                await this.loadStocks();
            }
        }
    },
    
    renderStocks(stocksData) {
        const grid = document.getElementById('mainStocksGrid');
        if (!grid) {
            error('mainStocksGrid not found');
            return;
        }
        
        // 기존 메인 차트 정리
        Object.keys(AppState.charts)
            .filter(key => key.startsWith('chart-') && !key.startsWith('chart-custom-'))
            .forEach(key => {
                try {
                    AppState.charts[key]?.dispose();
                } catch (e) {
                    error('Failed to dispose old main chart:', key, e);
                }
                delete AppState.charts[key];
                delete AppState.chartMeta[key];
            });

        grid.innerHTML = '';
        
        if (!stocksData || Object.keys(stocksData).length === 0) {
            error('No stocks data received');
            grid.innerHTML = '<div class="empty-state">표시할 종목이 없습니다.</div>';
            return;
        }
        
        log('Rendering', Object.keys(stocksData).length, 'stocks');
        
        Object.entries(stocksData).forEach(([ticker, data]) => {
            const normalized = normalizeStockPayload(data, ticker);
            if (!normalized) return;

            log('Rendering stock:', ticker, normalized.name);
            const safeTicker = ticker.replace(/\./g, '_');
            const cardId = `card-${safeTicker}`;
            const chartId = `chart-${safeTicker}`;

            const card = StockCard.create(cardId, chartId, normalized, ticker, false);
            grid.appendChild(card);

            // Render chart after DOM insertion
            setTimeout(() => {
                const container = document.getElementById(chartId);
                if (container) {
                    ChartRenderer.render(chartId, normalized, normalized.name || ticker);
                }
            }, 100);
        });
    },
    
    async updateMarketStatus() {
        try {
            const result = await API.get('/api/market-status');
            const statusEl = document.getElementById('marketStatus');
            
            if (statusEl && result.success) {
                const isOpen = result.is_market_open ?? result.is_open;
                statusEl.innerHTML = `
                    <span class="status-dot ${isOpen ? 'open' : 'closed'}"></span>
                    <span class="status-text">${isOpen ? '시장 개장' : '시장 마감'}</span>
                `;
            }
        } catch (err) {
            error('Failed to update market status:', err);
        }
    },
    
    updateLastUpdateTime() {
        const el = document.getElementById('lastUpdate');
        if (el) {
            el.textContent = new Date().toLocaleString('ko-KR');
        }
    },
    
    startAutoRefresh() {
        if (AppState.autoRefreshInterval) {
            clearInterval(AppState.autoRefreshInterval);
        }
        
        AppState.autoRefreshInterval = setInterval(() => {
            if (AppState.autoRefreshEnabled) {
                this.loadStocks();
            }
        }, CONFIG.REFRESH_INTERVAL);
    },
    
    stopAutoRefresh() {
        if (AppState.autoRefreshInterval) {
            clearInterval(AppState.autoRefreshInterval);
            AppState.autoRefreshInterval = null;
        }
    },
    
    loadSettings() {
        // Theme is already loaded in AppState initialization
        log('Settings loaded, theme:', AppState.currentTheme);
    },
    
    saveSettings() {
        localStorage.setItem('theme', AppState.currentTheme);
    }
};

// ========================================
// Part 13: Initialization
// ========================================

log('app.js loaded, waiting for DOMContentLoaded');

document.addEventListener('DOMContentLoaded', () => {
    log('DOM Content Loaded - Starting initialization');
    
    // Initialize notification system first
    Notification.init();
    
    // Initialize all managers
    try {
        TabManager.init();
        SettingsManager.init();
        SearchManager.init();
        PortfolioManager.init();
        BacktestManager.init();
        CustomChartsManager.init();
        MainStocksManager.init();
        
        // Start main app
        App.init();
        
        log('All systems initialized');
    } catch (err) {
        error('Initialization error:', err);
        Notification.toast('오류', '초기화 중 오류가 발생했습니다.', 'error');
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    App.stopAutoRefresh();
    App.saveSettings();
    
    // Dispose all charts
    Object.values(AppState.charts).forEach(chart => {
        if (chart && typeof chart.dispose === 'function') {
            try {
                chart.dispose();
            } catch (e) {
                // Ignore dispose errors
            }
        }
    });
});

// Expose managers to window for onclick handlers
window.SearchManager = SearchManager;
window.PortfolioManager = PortfolioManager;
window.CustomChartsManager = CustomChartsManager;
window.MainStocksManager = MainStocksManager;

log('app.js execution completed');