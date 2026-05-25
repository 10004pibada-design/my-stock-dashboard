// ========================================
// Part 1: Core Utilities
// ========================================

const AppState = {
    charts: {},
    autoRefreshInterval: null,
    autoRefreshEnabled: true,
    currentTheme: localStorage.getItem('theme') || 'light',
    notificationsEnabled: false,
    wsConnected: false
};

const CONFIG = {
    REFRESH_INTERVAL: 60000,
    ANIMATION_DURATION: 300,
    DEBOUNCE_DELAY: 300
};

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

const Notification = {
    toast(title, message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="toast-header">
                <i class="fas ${this.getIcon(type)}"></i>
                <span>${title}</span>
            </div>
            <div class="toast-body">${message}</div>
        `;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },
    
    getIcon(type) {
        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        return icons[type] || icons.info;
    },
    
    async requestPermission() {
        if (!('Notification' in window)) return false;
        if (Notification.permission === 'granted') return true;
        const result = await Notification.requestPermission();
        return result === 'granted';
    }
};

const API = {
    async request(url, options = {}) {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        try {
            const response = await fetch(url, { ...defaultOptions, ...options });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    },
    
    get(url) {
        return this.request(url);
    },
    
    post(url, data) {
        return this.request(url, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },
    
    put(url, data) {
        return this.request(url, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },
    
    delete(url) {
        return this.request(url, { method: 'DELETE' });
    },
    
    async getStockData(ticker) {
        const data = await this.get(`/api/stock/${encodeURIComponent(ticker)}`);
        return data?.data;
    },
    
    async searchStocks(query) {
        return await this.get(`/api/search?q=${encodeURIComponent(query)}`);
    },
    
    async addTicker(name, ticker) {
        return await this.post('/api/tickers', { name, ticker });
    },
    
    async getMarketStatus() {
        return await this.get('/api/market-status');
    }
};

const ChartRenderer = {
    render(chartId, data, name) {
        const chartDom = document.getElementById(chartId);
        if (!chartDom) return;
        
        if (AppState.charts[chartId]) {
            AppState.charts[chartId].dispose();
        }
        
        const chart = echarts.init(chartDom);
        AppState.charts[chartId] = chart;
        
        const isDark = AppState.currentTheme === 'dark';
        const textColor = isDark ? '#e5e7eb' : '#1f2937';
        const gridColor = isDark ? '#374151' : '#e5e7eb';
        
        const dates = data.dates || [];
        const kline = data.kline || [];
        const ma20 = data.ma20 || [];
        const ma60 = data.ma60 || [];
        const volumes = data.volumes || [];
        
        const option = {
            title: {
                text: name,
                left: 'center',
                textStyle: { color: textColor, fontSize: 14, fontWeight: 'bold' }
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
                backgroundColor: isDark ? '#1f2937' : '#ffffff',
                borderColor: isDark ? '#374151' : '#e5e7eb',
                textStyle: { color: textColor }
            },
            legend: {
                data: ['K-Line', 'MA20', 'MA60', 'Volume'],
                top: 25,
                textStyle: { color: textColor }
            },
            grid: [
                { left: '10%', right: '8%', height: '50%', top: 60 },
                { left: '10%', right: '8%', top: '68%', height: '16%' }
            ],
            xAxis: [
                {
                    type: 'category',
                    data: dates,
                    gridIndex: 0,
                    axisLine: { lineStyle: { color: gridColor } },
                    axisLabel: { color: textColor }
                },
                {
                    type: 'category',
                    data: dates,
                    gridIndex: 1,
                    axisLine: { lineStyle: { color: gridColor } },
                    axisLabel: { show: false }
                }
            ],
            yAxis: [
                {
                    scale: true,
                    gridIndex: 0,
                    splitLine: { lineStyle: { color: isDark ? '#374151' : '#f3f4f6' } },
                    axisLabel: { color: textColor }
                },
                {
                    scale: true,
                    gridIndex: 1,
                    splitLine: { show: false },
                    axisLabel: { show: false }
                }
            ],
            dataZoom: [
                { type: 'inside', xAxisIndex: [0, 1], start: 50, end: 100 },
                {
                    show: true,
                    xAxisIndex: [0, 1],
                    type: 'slider',
                    top: '85%',
                    start: 50,
                    end: 100,
                    textStyle: { color: textColor }
                }
            ],
            series: [
                {
                    name: 'K-Line',
                    type: 'candlestick',
                    data: kline.map(d => [d[0], d[1], d[2], d[3]]),
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
                    data: ma20,
                    smooth: true,
                    lineStyle: { color: '#f59e0b', width: 1 },
                    symbol: 'none'
                },
                {
                    name: 'MA60',
                    type: 'line',
                    data: ma60,
                    smooth: true,
                    lineStyle: { color: '#8b5cf6', width: 1 },
                    symbol: 'none'
                },
                {
                    name: 'Volume',
                    type: 'bar',
                    xAxisIndex: 1,
                    yAxisIndex: 1,
                    data: volumes,
                    itemStyle: {
                        color: (params) => {
                            const close = kline[params.dataIndex]?.[1] || 0;
                            const open = kline[params.dataIndex]?.[0] || 0;
                            return close >= open ? '#ef4444' : '#3b82f6';
                        }
                    }
                }
            ]
        };
        
        chart.setOption(option);
        
        chart.on('click', (params) => {
            console.log('Chart clicked:', params);
        });
        
        return chart;
    },
    
    updateTheme() {
        Object.values(AppState.charts).forEach(chart => {
            if (chart) {
                chart.dispose();
            }
        });
        AppState.charts = {};
        App.loadStocks();
    }
};

const StockCard = {
    create(cardId, chartId, data, ticker, removable = false) {
        const signalClass = data.signal_class || 'neutral';
        const changeClass = data.change_pct >= 0 ? 'positive' : 'negative';
        const changeIcon = data.change_pct >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';
        
        const div = document.createElement('div');
        div.id = cardId;
        div.className = 'stock-card';
        div.innerHTML = `
            <div class="stock-header">
                <h4>${data.name || ticker}</h4>
                <span class="signal-badge ${signalClass}">${data.signal_text || '분석중'}</span>
                ${removable ? `<button class="btn-remove" onclick="CustomChartsManager.removeCustomChart('${ticker}')" title="삭제"><i class="fas fa-times"></i></button>` : ''}
            </div>
            <div class="stock-price">
                <span class="current-price">${Utils.formatNumber(data.latest_price)}원</span>
                <span class="change-pct ${changeClass}">
                    <i class="fas ${changeIcon}"></i> ${Utils.formatPercent(data.change_pct)}
                </span>
            </div>
            <div class="stock-chart" id="${chartId}" style="width: 100%; height: 360px;"></div>
            <div class="stock-info">
                <span>거래량: ${Utils.formatNumber(data.latest_vol)}</span>
                <span>RSI: ${data.rsi_value ? data.rsi_value.toFixed(2) : '-'}</span>
            </div>
            <div class="signal-reason">${data.signal_reason || ''}</div>
        `;
        return div;
    }
};

// ========================================
// Part 2: Search & Settings Managers
// ========================================

const SearchManager = {
    init() {
        const searchInput = document.getElementById('stockSearch');
        const searchBtn = document.getElementById('searchBtn');
        
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce(() => {
                this.performSearch(searchInput.value.trim());
            }, 500));
            
            searchBtn?.addEventListener('click', () => {
                this.performSearch(searchInput.value.trim());
            });
            
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performSearch(searchInput.value.trim());
                }
            });
        }
        
        document.querySelectorAll('.chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const code = chip.dataset.code;
                const name = chip.textContent;
                this.addStock(name, code);
            });
        });
    },
    
    async performSearch(query) {
        if (!query || query.length < 2) {
            this.hideResults();
            return;
        }
        
        try {
            const result = await API.searchStocks(query);
            this.displayResults(result.results || []);
        } catch (error) {
            this.displayError('검색 중 오류가 발생했습니다.');
        }
    },
    
    displayResults(results) {
        const container = document.getElementById('searchResults');
        if (!container) return;
        
        if (results.length === 0) {
            container.innerHTML = '<div class="search-result-item"><div class="search-result-info"><span style="color: var(--text-muted);">검색 결과가 없습니다.</span></div></div>';
            container.style.display = 'block';
            return;
        }
        
        container.innerHTML = results.map(r => `
            <div class="search-result-item">
                <div class="search-result-info">
                    <h4>${r.name}</h4>
                    <span>${r.ticker}<span class="market-badge">${r.market}</span></span>
                </div>
                <button class="btn-add" onclick="SearchManager.addStock('${r.name}', '${r.ticker}')">
                    <i class="fas fa-plus"></i> 추가
                </button>
            </div>
        `).join('');
        
        container.style.display = 'block';
    },
    
    displayError(message) {
        const container = document.getElementById('searchResults');
        if (!container) return;
        container.innerHTML = `<div class="search-result-item"><div class="search-result-info"><span style="color: var(--accent-red);">${message}</span></div></div>`;
        container.style.display = 'block';
    },
    
    hideResults() {
        const container = document.getElementById('searchResults');
        if (container) container.style.display = 'none';
    },
    
    async addStock(name, ticker) {
        try {
            const result = await API.addTicker(name, ticker);
            
            if (result.success) {
                Notification.toast('추가 완료', `${name}가 관심 종목에 추가되었습니다.`, 'success');
                
                if (result.data) {
                    result.data.name = name;
                    this.addStockCard(ticker, result.data);
                }
                
                const searchInput = document.getElementById('stockSearch');
                if (searchInput) searchInput.value = '';
                this.hideResults();
                
                setTimeout(() => App.loadStocks(), 1000);
            } else {
                Notification.toast('추가 실패', result.error || '종목을 추가할 수 없습니다.', 'error');
            }
        } catch (error) {
            Notification.toast('오류', '종목 추가 중 오류가 발생했습니다.', 'error');
        }
    },
    
    addStockCard(ticker, data, targetGrid = 'mainStocksGrid') {
        const grid = document.getElementById(targetGrid);
        if (!grid) {
            console.error(`Grid ${targetGrid} not found`);
            return;
        }

        const emptyState = grid.querySelector('.empty-state-custom');
        if (emptyState) emptyState.remove();

        const cardId = `card-${ticker.replace(/\./g, '_')}`;
        const chartId = `chart-${ticker.replace(/\./g, '_')}`;
        
        const existingCard = document.getElementById(cardId);
        if (existingCard) {
            existingCard.remove();
        }

        const card = StockCard.create(cardId, chartId, data, ticker);
        grid.appendChild(card);

        this.$nextTick(() => {
            const chartContainer = document.getElementById(chartId);
            if (chartContainer) {
                chartContainer.style.width = '100%';
                chartContainer.style.height = '360px';
                ChartRenderer.render(chartId, data, data.name);
            }
        });
    },
    
    $nextTick(callback) {
        setTimeout(callback, 0);
    }
};

const SettingsManager = {
    init() {
        const themeToggle = document.getElementById('themeToggle');
        themeToggle?.addEventListener('click', () => this.toggleTheme());
        
        const refreshBtn = document.getElementById('refreshBtn');
        refreshBtn?.addEventListener('click', () => {
            App.loadStocks();
            Notification.toast('새로고침', '데이터를 업데이트했습니다.', 'info');
        });
        
        this.applyTheme(AppState.currentTheme);
    },
    
    toggleTheme() {
        const newTheme = AppState.currentTheme === 'light' ? 'dark' : 'light';
        this.applyTheme(newTheme);
        AppState.currentTheme = newTheme;
        localStorage.setItem('theme', newTheme);
        
        const icon = document.querySelector('#themeToggle i');
        if (icon) {
            icon.className = newTheme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
        }
        
        ChartRenderer.updateTheme();
    },
    
    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
    },
    
    updateMarketStatus(data) {
        const statusEl = document.getElementById('marketStatus');
        if (!statusEl || !data) return;
        
        const isOpen = data.is_market_open;
        statusEl.innerHTML = `
            <span class="status-dot ${isOpen ? 'open' : 'closed'}"></span>
            <span class="status-text">${isOpen ? '시장 열림' : '시장 닫힘'}</span>
        `;
    },
    
    updateRefreshIndicator() {
        const indicator = document.getElementById('refreshIndicator');
        if (indicator) {
            indicator.style.display = AppState.autoRefreshEnabled ? 'inline-flex' : 'none';
        }
    }
};

const App = {
    async init() {
        await this.loadStocks();
        await this.updateMarketStatus();
        this.startAutoRefresh();
    },
    
    async loadStocks() {
        try {
            const grid = document.getElementById('mainStocksGrid');
            if (grid) {
                grid.innerHTML = `
                    <div class="loading-skeleton">
                        <div class="skeleton-card"></div>
                        <div class="skeleton-card"></div>
                    </div>
                `;
            }
            
            const result = await API.get('/api/stocks');
            
            if (result.success && result.data) {
                this.renderStocks(result.data);
                this.updateLastUpdateTime();
            }
        } catch (error) {
            console.error('Failed to load stocks:', error);
            Notification.toast('오류', '데이터 로딩에 실패했습니다.', 'error');
        }
    },
    
    renderStocks(stocksData) {
        const grid = document.getElementById('mainStocksGrid');
        if (!grid) return;
        
        grid.innerHTML = '';
        
        Object.entries(stocksData).forEach(([ticker, data]) => {
            const cardId = `card-${ticker.replace(/\./g, '_')}`;
            const chartId = `chart-${ticker.replace(/\./g, '_')}`;
            
            const card = StockCard.create(cardId, chartId, data, ticker);
            grid.appendChild(card);
            
            setTimeout(() => {
                const chartContainer = document.getElementById(chartId);
                if (chartContainer) {
                    chartContainer.style.width = '100%';
                    chartContainer.style.height = '360px';
                    ChartRenderer.render(chartId, data, data.name);
                }
            }, 100);
        });
    },
    
    updateLastUpdateTime() {
        const lastUpdate = document.getElementById('lastUpdate');
        if (lastUpdate) {
            lastUpdate.textContent = new Date().toLocaleTimeString('ko-KR');
        }
    },
    
    saveSettings() {
        localStorage.setItem('autoRefresh', AppState.autoRefreshEnabled);
        localStorage.setItem('theme', AppState.currentTheme);
    },
    
    loadSettings() {
        AppState.autoRefreshEnabled = localStorage.getItem('autoRefresh') !== 'false';
        AppState.currentTheme = localStorage.getItem('theme') || 'light';
        SettingsManager.applyTheme(AppState.currentTheme);
    },
    
    async updateMarketStatus() {
        try {
            const result = await API.getMarketStatus();
            if (result.success) {
                SettingsManager.updateMarketStatus(result);
            }
        } catch (error) {
            console.error('Market status error:', error);
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
        
        SettingsManager.updateRefreshIndicator();
    },
    
    stopAutoRefresh() {
        if (AppState.autoRefreshInterval) {
            clearInterval(AppState.autoRefreshInterval);
            AppState.autoRefreshInterval = null;
        }
        SettingsManager.updateRefreshIndicator();
    }
};

// ========================================
// Part 3: Tab, Portfolio, Backtest Managers
// ========================================

const TabManager = {
    init() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e));
        });
    },
    
    switchTab(e) {
        const tabId = e.currentTarget.dataset.tab;
        if (!tabId) return;
        
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        e.currentTarget.classList.add('active');
        
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        
        const targetContent = document.getElementById(`${tabId}Tab`);
        if (targetContent) {
            targetContent.classList.add('active');
        }
        
        if (tabId === 'portfolio') {
            PortfolioManager.loadPortfolio();
        }
    }
};

const PortfolioManager = {
    init() {
        const addBtn = document.getElementById('addPortfolioBtn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.addHolding());
        }
        
        ['portfolioTicker', 'portfolioName', 'portfolioShares', 'portfolioPrice'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') this.addHolding();
                });
            }
        });
    },
    
    async addHolding() {
        const tickerInput = document.getElementById('portfolioTicker');
        const nameInput = document.getElementById('portfolioName');
        const sharesInput = document.getElementById('portfolioShares');
        const priceInput = document.getElementById('portfolioPrice');
        
        if (!tickerInput || !nameInput || !sharesInput || !priceInput) return;
        
        const ticker = tickerInput.value.trim();
        const name = nameInput.value.trim();
        const shares = parseFloat(sharesInput.value);
        const avgPrice = parseFloat(priceInput.value);
        
        if (!ticker || !name || isNaN(shares) || shares <= 0 || isNaN(avgPrice) || avgPrice <= 0) {
            Notification.toast('입력 오류', '모든 필드를 올바르게 입력해주세요.', 'error');
            return;
        }
        
        let formattedTicker = ticker;
        if (/^\d{6}$/.test(ticker)) {
            formattedTicker = `${ticker}.KS`;
        }
        
        try {
            const result = await API.post('/api/portfolio', {
                ticker: formattedTicker,
                name: name,
                shares: shares,
                avg_price: avgPrice
            });
            
            if (result.success) {
                Notification.toast('추가 완료', `${name}가 포트폴리오에 추가되었습니다.`, 'success');
                
                tickerInput.value = '';
                nameInput.value = '';
                sharesInput.value = '';
                priceInput.value = '';
                
                this.loadPortfolio();
            } else {
                Notification.toast('오류', result.error || '추가에 실패했습니다.', 'error');
            }
        } catch (error) {
            Notification.toast('오류', '서버 연결에 실패했습니다.', 'error');
        }
    },
    
    async loadPortfolio() {
        try {
            const result = await API.get('/api/portfolio');
            if (result.success && result.data) {
                this.renderPortfolio(result.data);
            }
        } catch (error) {
            console.error('Portfolio load error:', error);
        }
    },
    
    renderPortfolio(data) {
        const tbody = document.getElementById('portfolioTableBody');
        const summary = data.summary || {};
        const holdings = data.holdings || [];
        
        const totalInvestedEl = document.getElementById('totalInvested');
        const currentValueEl = document.getElementById('currentValue');
        const totalReturnEl = document.getElementById('totalReturn');
        
        if (totalInvestedEl) {
            totalInvestedEl.textContent = Utils.formatNumber(summary.total_invested || 0) + '원';
        }
        if (currentValueEl) {
            currentValueEl.textContent = Utils.formatNumber(summary.current_value || 0) + '원';
        }
        if (totalReturnEl) {
            const returnPct = summary.return_pct || 0;
            const returnValue = summary.total_return || 0;
            const isPositive = returnValue >= 0;
            totalReturnEl.innerHTML = `
                <span class="${isPositive ? 'positive' : 'negative'}">
                    ${isPositive ? '+' : ''}${Utils.formatNumber(returnValue)}원 
                    (${isPositive ? '+' : ''}${returnPct.toFixed(2)}%)
                </span>
            `;
        }
        
        if (!tbody) return;
        
        if (holdings.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="8">보유 종목이 없습니다. 종목을 추가하세요.</td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = holdings.map(h => {
            const profitClass = h.profit_loss >= 0 ? 'positive' : 'negative';
            const profitIcon = h.profit_loss >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';
            
            return `
                <tr data-id="${h.id}">
                    <td><strong>${h.name}</strong><br><small>${h.ticker}</small></td>
                    <td contenteditable="true" onblur="PortfolioManager.updateHolding('${h.id}', 'shares', this.textContent)">${h.shares}</td>
                    <td contenteditable="true" onblur="PortfolioManager.updateHolding('${h.id}', 'avg_price', this.textContent)">${Utils.formatNumber(h.avg_price)}</td>
                    <td>${Utils.formatNumber(h.current_price || h.avg_price)}</td>
                    <td>${Utils.formatNumber(h.current_value || 0)}</td>
                    <td class="${profitClass}">
                        <i class="fas ${profitIcon}"></i> ${Utils.formatNumber(h.profit_loss || 0)}
                    </td>
                    <td class="${profitClass}">${h.return_pct >= 0 ? '+' : ''}${(h.return_pct || 0).toFixed(2)}%</td>
                    <td>
                        <button class="btn-icon-small" onclick="PortfolioManager.deleteHolding('${h.id}')" title="삭제">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },
    
    async updateHolding(id, field, value) {
        const numValue = parseFloat(value.replace(/,/g, ''));
        if (isNaN(numValue)) {
            Notification.toast('오류', '올바른 숫자를 입력해주세요.', 'error');
            this.loadPortfolio();
            return;
        }
        
        try {
            const result = await API.put(`/api/portfolio/${id}`, { field, value: numValue });
            if (result.success) {
                Notification.toast('수정 완료', '보유 정보가 업데이트되었습니다.', 'success');
                this.loadPortfolio();
            }
        } catch (error) {
            Notification.toast('오류', '수정에 실패했습니다.', 'error');
        }
    },
    
    async deleteHolding(id) {
        if (!confirm('정말 삭제하시겠습니까?')) return;
        
        try {
            const result = await API.delete(`/api/portfolio/${id}`);
            if (result.success) {
                Notification.toast('삭제 완료', '종목이 삭제되었습니다.', 'success');
                this.loadPortfolio();
            }
        } catch (error) {
            Notification.toast('오류', '삭제에 실패했습니다.', 'error');
        }
    }
};

const BacktestManager = {
    chart: null,
    
    init() {
        const runBtn = document.getElementById('runBacktestBtn');
        if (runBtn) {
            runBtn.addEventListener('click', () => this.runBacktest());
        }
        
        const tickerInput = document.getElementById('backtestTicker');
        if (tickerInput) {
            tickerInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.runBacktest();
            });
        }
    },
    
    async runBacktest() {
        const tickerInput = document.getElementById('backtestTicker');
        const periodSelect = document.getElementById('backtestPeriod');
        
        if (!tickerInput || !periodSelect) return;
        
        let ticker = tickerInput.value.trim();
        const period = periodSelect.value;
        
        if (!ticker) {
            Notification.toast('입력 오류', '종목코드를 입력해주세요.', 'error');
            return;
        }
        
        if (/^\d{6}$/.test(ticker)) {
            ticker = `${ticker}.KS`;
        }
        
        const runBtn = document.getElementById('runBacktestBtn');
        if (runBtn) {
            runBtn.disabled = true;
            runBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 분석 중...';
        }
        
        try {
            const result = await API.get(`/api/backtest/${encodeURIComponent(ticker)}?period=${period}`);
            
            if (result.success) {
                this.renderResults(result.data);
                Notification.toast('완료', '백테스트가 완료되었습니다.', 'success');
            } else {
                Notification.toast('오류', result.error || '백테스트에 실패했습니다.', 'error');
            }
        } catch (error) {
            Notification.toast('오류', '서버 연결에 실패했습니다.', 'error');
        } finally {
            if (runBtn) {
                runBtn.disabled = false;
                runBtn.innerHTML = '<i class="fas fa-play"></i> 백테스트 실행';
            }
        }
    },
    
    renderResults(data) {
        const resultsDiv = document.getElementById('backtestResults');
        const summaryDiv = document.getElementById('backtestSummary');
        const tradesTbody = document.getElementById('tradesTableBody');
        
        if (resultsDiv) resultsDiv.style.display = 'block';
        
        if (summaryDiv) {
            summaryDiv.innerHTML = `
                <div class="summary-grid">
                    <div class="summary-item">
                        <span class="label">총 거래 횟수</span>
                        <span class="value">${data.total_trades || 0}회</span>
                    </div>
                    <div class="summary-item">
                        <span class="label">승률</span>
                        <span class="value ${data.win_rate >= 50 ? 'positive' : 'negative'}">${(data.win_rate || 0).toFixed(1)}%</span>
                    </div>
                    <div class="summary-item">
                        <span class="label">총 수익률</span>
                        <span class="value ${data.total_profit_pct >= 0 ? 'positive' : 'negative'}">${data.total_profit_pct >= 0 ? '+' : ''}${(data.total_profit_pct || 0).toFixed(2)}%</span>
                    </div>
                    <div class="summary-item">
                        <span class="label">최대 낙폭</span>
                        <span class="value">${(data.max_drawdown || 0).toFixed(2)}%</span>
                    </div>
                </div>
            `;
        }
        
        if (tradesTbody) {
            const trades = data.trades || [];
            if (trades.length === 0) {
                tradesTbody.innerHTML = '<tr><td colspan="6" class="empty-row">거래 내역이 없습니다.</td></tr>';
            } else {
                tradesTbody.innerHTML = trades.map(t => {
                    const profitClass = t.profit >= 0 ? 'positive' : 'negative';
                    return `
                        <tr>
                            <td>${t.entry_date}</td>
                            <td>${Utils.formatNumber(t.entry_price)}</td>
                            <td>${t.exit_date || '-'}</td>
                            <td>${t.exit_price ? Utils.formatNumber(t.exit_price) : '-'}</td>
                            <td class="${profitClass}">${t.profit >= 0 ? '+' : ''}${Utils.formatNumber(t.profit)}</td>
                            <td class="${profitClass}">${t.profit_pct >= 0 ? '+' : ''}${t.profit_pct.toFixed(2)}%</td>
                        </tr>
                    `;
                }).join('');
            }
        }
        
        this.renderChart(data);
    },
    
    renderChart(data) {
        const chartDiv = document.getElementById('backtestChart');
        if (!chartDiv) return;
        
        if (this.chart) {
            this.chart.dispose();
        }
        
        this.chart = echarts.init(chartDiv);
        
        const equityCurve = data.equity_curve || [];
        const dates = equityCurve.map(e => e.date);
        const equities = equityCurve.map(e => e.equity);
        
        const isDark = AppState.currentTheme === 'dark';
        
        const option = {
            title: {
                text: '자산 곡선',
                left: 'center',
                textStyle: { color: isDark ? '#fff' : '#333' }
            },
            tooltip: {
                trigger: 'axis',
                formatter: '{b}<br/>자산: {c}원'
            },
            xAxis: {
                type: 'category',
                data: dates,
                axisLabel: { color: isDark ? '#aaa' : '#666' }
            },
            yAxis: {
                type: 'value',
                axisLabel: { 
                    color: isDark ? '#aaa' : '#666',
                    formatter: value => (value / 1000000).toFixed(0) + 'M'
                }
            },
            series: [{
                name: '자산',
                type: 'line',
                data: equities,
                smooth: true,
                lineStyle: { width: 3, color: '#2563eb' },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(37, 99, 235, 0.3)' },
                        { offset: 1, color: 'rgba(37, 99, 235, 0.05)' }
                    ])
                }
            }],
            grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true }
        };
        
        this.chart.setOption(option);
    }
};

const CustomChartsManager = {
    init() {
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
        
        this.loadSavedCharts();
    },
    
    async addCustomChart() {
        const input = document.getElementById('customTickerInput');
        if (!input) return;
        
        let ticker = input.value.trim();
        if (!ticker) {
            Notification.toast('입력 오류', '종목코드를 입력해주세요.', 'error');
            return;
        }
        
        if (/^\d{6}$/.test(ticker)) {
            ticker = `${ticker}.KS`;
        }
        
        const addBtn = document.getElementById('addCustomChartBtn');
        if (addBtn) {
            addBtn.disabled = true;
            addBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 추가 중...';
        }
        
        try {
            const data = await API.getStockData(ticker);
            
            if (data) {
                const saved = JSON.parse(localStorage.getItem('customCharts') || '[]');
                if (!saved.includes(ticker)) {
                    saved.push(ticker);
                    localStorage.setItem('customCharts', JSON.stringify(saved));
                }
                
                this.addStockCard(ticker, data);
                input.value = '';
                
                Notification.toast('추가 완료', `${data.name || ticker} 차트가 추가되었습니다.`, 'success');
            }
        } catch (error) {
            Notification.toast('오류', '종목 데이터를 가져올 수 없습니다.', 'error');
        } finally {
            if (addBtn) {
                addBtn.disabled = false;
                addBtn.innerHTML = '<i class="fas fa-plus"></i> 차트 추가';
            }
        }
    },
    
    addStockCard(ticker, data) {
        const container = document.getElementById('customStocksGrid');
        const emptyState = document.getElementById('emptyCustomCharts');
        
        if (!container) return;
        
        if (emptyState) {
            emptyState.style.display = 'none';
        }
        
        const cardId = `custom-card-${ticker.replace(/\./g, '_')}`;
        const chartId = `chart-${ticker.replace(/\./g, '_')}`;
        
        if (document.getElementById(cardId)) {
            Notification.toast('알림', '이미 추가된 종목입니다.', 'warning');
            return;
        }
        
        const card = StockCard.create(cardId, chartId, data, ticker, true);
        container.appendChild(card);
        
        setTimeout(() => {
            const chartContainer = document.getElementById(chartId);
            if (chartContainer) {
                chartContainer.style.width = '100%';
                chartContainer.style.height = '360px';
                ChartRenderer.render(chartId, data, data.name);
            }
        }, 100);
    },
    
    removeCustomChart(ticker) {
        const cardId = `custom-card-${ticker.replace(/\./g, '_')}`;
        const chartId = `chart-${ticker.replace(/\./g, '_')}`;
        
        if (AppState.charts[chartId]) {
            AppState.charts[chartId].dispose();
            delete AppState.charts[chartId];
        }
        
        const card = document.getElementById(cardId);
        if (card) {
            card.remove();
        }
        
        const saved = JSON.parse(localStorage.getItem('customCharts') || '[]');
        const index = saved.indexOf(ticker);
        if (index > -1) {
            saved.splice(index, 1);
            localStorage.setItem('customCharts', JSON.stringify(saved));
        }
        
        const container = document.getElementById('customStocksGrid');
        const emptyState = document.getElementById('emptyCustomCharts');
        if (container && emptyState && container.children.length <= 1) {
            emptyState.style.display = 'block';
        }
    },
    
    async loadSavedCharts() {
        const saved = JSON.parse(localStorage.getItem('customCharts') || '[]');
        
        for (const ticker of saved) {
            try {
                const data = await API.getStockData(ticker);
                if (data) {
                    this.addStockCard(ticker, data);
                }
            } catch (error) {
                console.warn(`Failed to load custom chart for ${ticker}:`, error);
            }
        }
    }
};

// ========================================
// Part 4: Initialization
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    App.loadSettings();
    
    SearchManager.init();
    SettingsManager.init();
    TabManager.init();
    PortfolioManager.init();
    BacktestManager.init();
    CustomChartsManager.init();
    
    App.init();
    
    window.SearchManager = SearchManager;
    window.PortfolioManager = PortfolioManager;
    window.CustomChartsManager = CustomChartsManager;
});

window.addEventListener('beforeunload', () => {
    App.stopAutoRefresh();
    App.saveSettings();
    
    Object.values(AppState.charts).forEach(chart => {
        if (chart) chart.dispose();
    });
});