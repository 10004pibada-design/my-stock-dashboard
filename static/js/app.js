

// ========================================
// 검색 및 추가
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

        const card = StockCard.create(ticker, data);
        grid.appendChild(card);

        setTimeout(() => {
            const chartId = `chart-${ticker.replace(/\./g, '_')}`;
            const chartContainer = document.getElementById(chartId);
            if (chartContainer) {
                chartContainer.style.width = '100%';
                chartContainer.style.height = '360px';
                ChartRenderer.render(chartId, data, data.name);
            }
        }, 100);
    }
};

// ========================================
// 설정 관리
// ========================================
const SettingsManager = {
    init() {
        const themeToggle = document.getElementById('themeToggle');
        themeToggle?.addEventListener('click', () => this.toggleTheme());
        
        const settingsBtn = document.getElementById('settingsBtn');
        const notificationSection = document.getElementById('notificationSection');
        settingsBtn?.addEventListener('click', () => {
            if (notificationSection) {
                notificationSection.style.display = notificationSection.style.display === 'none' ? 'block' : 'none';
            }
        });
        
        const notifEnabled = document.getElementById('notifEnabled');
        notifEnabled?.addEventListener('change', async () => {
            if (notifEnabled.checked) {
                const granted = await Notification.requestPermission();
                AppState.notificationsEnabled = granted;
                if (!granted) {
                    Notification.toast('알림 권한 필요', '브라우저 알림 권한을 허용해주세요.', 'warning');
                    notifEnabled.checked = false;
                }
            } else {
                AppState.notificationsEnabled = false;
            }
        });
        
        const autoRefresh = document.getElementById('autoRefresh');
        autoRefresh?.addEventListener('change', () => {
            AppState.autoRefreshEnabled = autoRefresh.checked;
            if (autoRefresh.checked) {
                App.startAutoRefresh();
            } else {
                App.stopAutoRefresh();
            }
            this.updateRefreshIndicator();
        });
        
        const rsiAlert = document.getElementById('rsiAlert');
        rsiAlert?.addEventListener('change', () => {
            AppState.alertSettings.rsi = rsiAlert.checked;
        });
        
        const crossAlert = document.getElementById('crossAlert');
        crossAlert?.addEventListener('change', () => {
            AppState.alertSettings.cross = crossAlert.checked;
        });
        
        const refreshBtn = document.getElementById('refreshBtn');
        refreshBtn?.addEventListener('click', () => {
            refreshBtn.classList.add('spinning');
            App.loadStocks().then(() => {
                setTimeout(() => refreshBtn.classList.remove('spinning'), 500);
            });
        });
    },
    
    toggleTheme() {
        AppState.darkMode = !AppState.darkMode;
        document.documentElement.setAttribute('data-theme', AppState.darkMode ? 'dark' : 'light');
        
        const icon = document.querySelector('#themeToggle i');
        if (icon) icon.className = AppState.darkMode ? 'fas fa-sun' : 'fas fa-moon';
        
        Object.keys(AppState.charts).forEach(chartId => {
            const chart = AppState.charts[chartId];
            if (chart) {
                const ticker = chartId.replace('chart-', '').replace(/_/g, '.');
                const data = AppState.tickers[ticker];
                if (data) ChartRenderer.render(chartId, data, data.name);
            }
        });
    },
    
    updateRefreshIndicator() {
        const indicator = document.getElementById('refreshIndicator');
        if (indicator) {
            indicator.className = AppState.autoRefreshEnabled 
                ? 'auto-refresh-indicator' 
                : 'auto-refresh-indicator paused';
            indicator.innerHTML = AppState.autoRefreshEnabled 
                ? '<i class="fas fa-sync fa-spin"></i> 자동 갱신 중' 
                : '<i class="fas fa-pause"></i> 자동 갱신 일시중지';
        }
    },
    
    updateMarketStatus(status) {
        const statusEl = document.getElementById('marketStatus');
        if (!statusEl) return;
        const dot = statusEl.querySelector('.status-dot');
        const text = statusEl.querySelector('.status-text');
        
        if (status.is_market_open) {
            dot?.classList.add('open');
            if (text) text.textContent = '장중';
        } else {
            dot?.classList.remove('open');
            if (text) text.textContent = '장마감';
        }
    }
};

// ========================================
// 메인 앱
// ========================================
const App = {
    async init() {
        this.loadSettings();
        
        TabManager.init();
        SearchManager.init();
        SettingsManager.init();
        PortfolioManager.init();
        BacktestManager.init();
        CustomChartsManager.init();
        
        await this.loadStocks();
        
        this.updateMarketStatus();
        
        if (AppState.autoRefreshEnabled) {
            this.startAutoRefresh();
        }
        
        setInterval(() => this.updateMarketStatus(), 60000);
        
        WebSocketManager.init();
    },
    
    loadSettings() {
        const saved = localStorage.getItem('stockDashboardSettings');
        if (saved) {
            try {
                const settings = JSON.parse(saved);
                AppState.darkMode = settings.darkMode || false;
                AppState.notificationsEnabled = settings.notificationsEnabled || false;
                AppState.autoRefreshEnabled = settings.autoRefreshEnabled !== false;
                AppState.alertSettings = settings.alertSettings || { rsi: true, cross: true };
            } catch (e) {
                console.error('Error loading settings:', e);
            }
        }
        
        document.documentElement.setAttribute('data-theme', AppState.darkMode ? 'dark' : 'light');
        
        const autoRefresh = document.getElementById('autoRefresh');
        if (autoRefresh) autoRefresh.checked = AppState.autoRefreshEnabled;
        
        const rsiAlert = document.getElementById('rsiAlert');
        if (rsiAlert) rsiAlert.checked = AppState.alertSettings.rsi;
        
        const crossAlert = document.getElementById('crossAlert');
        if (crossAlert) crossAlert.checked = AppState.alertSettings.cross;
        
        const themeIcon = document.querySelector('#themeToggle i');
        if (themeIcon) themeIcon.className = AppState.darkMode ? 'fas fa-sun' : 'fas fa-moon';
    },
    
    saveSettings() {
        localStorage.setItem('stockDashboardSettings', JSON.stringify({
            darkMode: AppState.darkMode,
            notificationsEnabled: AppState.notificationsEnabled,
            autoRefreshEnabled: AppState.autoRefreshEnabled,
            alertSettings: AppState.alertSettings
        }));
    },
    
    async loadStocks() {
        try {
            const result = await API.getAllStocks();
            
            if (result.success) {
                AppState.tickers = result.data;
                this.renderStocks(result.data);
                
                const lastUpdate = document.getElementById('lastUpdate');
                if (lastUpdate) lastUpdate.textContent = new Date().toLocaleTimeString('ko-KR');
            }
        } catch (error) {
            Notification.toast('데이터 로드 실패', '주식 데이터를 불러오는데 실패했습니다.', 'error');
        }
    },
    
    renderStocks(stocks) {
        const grid = document.getElementById('stocksGrid');
        if (!grid) return;
        
        const skeleton = grid.querySelector('.loading-skeleton');
        if (skeleton) skeleton.remove();
        
        Object.entries(stocks).forEach(([ticker, data]) => {
            const cardId = `card-${ticker.replace(/\./g, '_')}`;
            let card = document.getElementById(cardId);
            
            if (!card) {
                card = StockCard.create(ticker, data);
                grid.appendChild(card);
                
                setTimeout(() => {
                    ChartRenderer.render(`chart-${ticker.replace(/\./g, '_')}`, data, data.name);
                }, 100);
            } else {
                this.updateCard(card, data);
            }
            
            StockCard.checkAlerts(ticker, data);
        });
    },
    
    updateCard(card, data) {
        const kpiValues = card.querySelectorAll('.kpi-value');
        if (kpiValues[0]) {
            const changeClass = data.change_pct > 0 ? 'up' : data.change_pct < 0 ? 'down' : 'neutral';
            kpiValues[0].className = `kpi-value ${changeClass}`;
            kpiValues[0].innerHTML = `${Utils.formatNumber(Math.round(data.latest_price))}<span class="unit">원</span>`;
        }
        if (kpiValues[1]) {
            kpiValues[1].innerHTML = `${Utils.formatNumber(data.latest_vol)}<span class="unit">주</span>`;
        }
        if (kpiValues[2]) {
            kpiValues[2].textContent = Utils.formatNumber(Math.round(data.ma20[data.ma20.length - 1]));
        }
        if (kpiValues[3]) {
            kpiValues[3].textContent = Utils.formatNumber(Math.round(data.ma60[data.ma60.length - 1]));
        }
        
        const changeBadge = card.querySelector('.change-badge');
        if (changeBadge) {
            const changeClass = data.change_pct > 0 ? 'up' : data.change_pct < 0 ? 'down' : 'neutral';
            const changeIcon = data.change_pct > 0 ? '▲' : data.change_pct < 0 ? '▼' : '-';
            changeBadge.className = `change-badge ${changeClass}`;
            changeBadge.innerHTML = `${changeIcon} ${Math.abs(data.change_pct).toFixed(2)}%`;
        }
        
        const signalBox = card.querySelector('.signal-box');
        if (signalBox) {
            signalBox.className = `signal-box ${data.signal_class}`;
            const signalIcon = signalBox.querySelector('.signal-icon');
            const signalTitle = signalBox.querySelector('.signal-title');
            const signalReason = signalBox.querySelector('.signal-reason');
            if (signalIcon) signalIcon.textContent = StockCard.getSignalIcon(data.signal_class);
            if (signalTitle) signalTitle.textContent = data.signal_text;
            if (signalReason) signalReason.textContent = data.signal_reason;
        }
        
        const chartId = `chart-${data.ticker.replace(/\./g, '_')}`;
        if (AppState.charts[chartId]) {
            ChartRenderer.render(chartId, data, data.name);
        }
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
// 탭 관리자
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
        
        // 버튼 상태 변경
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        e.currentTarget.classList.add('active');
        
        // 컨텐츠 변경
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        
        const targetContent = document.getElementById(`${tabId}Tab`);
        if (targetContent) {
            targetContent.classList.add('active');
        }
        
        // 탭별 초기화
        if (tabId === 'portfolio') {
            PortfolioManager.loadPortfolio();
        } else if (tabId === 'backtest') {
            // 백테스트 탭은 별도 초기화 필요 없음
        }
    }
};

// ========================================
// 포트폴리오 관리자
// ========================================
const PortfolioManager = {
    init() {
        const addBtn = document.getElementById('addPortfolioBtn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.addHolding());
        }
        
        // 입력 필드 엔터 키
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
        
        // 티커 형식 보정
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
                
                // 입력 필드 초기화
                tickerInput.value = '';
                nameInput.value = '';
                sharesInput.value = '';
                priceInput.value = '';
                
                // 포트폴리오 다시 로드
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
        
        // 요약 정보 업데이트
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
        
        // 테이블 업데이트
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

// ========================================
// 백테스트 관리자
// ========================================
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
        
        // 티커 형식 보정
        if (/^\d{6}$/.test(ticker)) {
            ticker = `${ticker}.KS`;
        }
        
        const runBtn = document.getElementById('runBacktestBtn');
        if (runBtn) {
            runBtn.disabled = true;
            runBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 분석 중...';
        }
        
        try {
            // IMPORTANT: Backend expects URL parameter /api/backtest/<ticker>?period=...
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
        
        // 요약 렌더링
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
        
        // 거래 내역 렌더링
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
        
        // 차트 렌더링
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
        
        const option = {
            title: {
                text: '자산 곡선',
                left: 'center',
                textStyle: { color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#fff' : '#333' }
            },
            tooltip: {
                trigger: 'axis',
                formatter: '{b}<br/>자산: {c}원'
            },
            xAxis: {
                type: 'category',
                data: dates,
                axisLabel: { color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#aaa' : '#666' }
            },
            yAxis: {
                type: 'value',
                axisLabel: { 
                    color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#aaa' : '#666',
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
        
        // 테마 변경 시 차트 업데이트
        window.addEventListener('themechange', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            this.chart.setOption({
                title: { textStyle: { color: isDark ? '#fff' : '#333' } },
                xAxis: { axisLabel: { color: isDark ? '#aaa' : '#666' } },
                yAxis: { axisLabel: { color: isDark ? '#aaa' : '#666' } }
            });
        });
    }
};

// ========================================
// 추가 차트 관리자
// ========================================
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
        
        // 저장된 추가 차트 로드
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
        
        // 티커 형식 보정
        if (/^\d{6}$/.test(ticker)) {
            ticker = `${ticker}.KS`;
        }
        
        // 로딩 표시
        const addBtn = document.getElementById('addCustomChartBtn');
        if (addBtn) {
            addBtn.disabled = true;
            addBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 추가 중...';
        }
        
        try {
            const data = await API.getStockData(ticker);
            
            if (data) {
                // 저장된 차트 목록에 추가
                const saved = JSON.parse(localStorage.getItem('customCharts') || '[]');
                if (!saved.includes(ticker)) {
                    saved.push(ticker);
                    localStorage.setItem('customCharts', JSON.stringify(saved));
                }
                
                // 카드 추가
                this.addStockCard(ticker, data);
                
                // 입력 필드 초기화
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
        
        // 이미 존재하는 카드인지 확인
        if (document.getElementById(cardId)) {
            Notification.toast('알림', '이미 추가된 종목입니다.', 'warning');
            return;
        }
        
        const card = StockCard.create(cardId, chartId, data, ticker, true);
        container.insertAdjacentHTML('beforeend', card);
        
        // 차트 초기화
        this.$nextTick(() => {
            if (AppState.charts[chartId]) {
                ChartRenderer.render(chartId, data, data.name);
            }
        });
    },
    
    removeCustomChart(ticker) {
        const cardId = `custom-card-${ticker.replace(/\./g, '_')}`;
        const chartId = `chart-${ticker.replace(/\./g, '_')}`;
        
        // 차트 dispose
        if (AppState.charts[chartId]) {
            AppState.charts[chartId].dispose();
            delete AppState.charts[chartId];
        }
        
        // DOM 제거
        const card = document.getElementById(cardId);
        if (card) {
            card.remove();
        }
        
        // 저장 목록에서 제거
        const saved = JSON.parse(localStorage.getItem('customCharts') || '[]');
        const index = saved.indexOf(ticker);
        if (index > -1) {
            saved.splice(index, 1);
            localStorage.setItem('customCharts', JSON.stringify(saved));
        }
        
        // 빈 상태 확인
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
    },
    
    $nextTick(callback) {
        setTimeout(callback, 0);
    }
};

// ========================================
// WebSocket 관리자
// ========================================
const WebSocketManager = {
    socket: null,
    isConnected: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    reconnectDelay: 3000,
    
    init() {
        this.connect();
    },
    
    connect() {
        try {
            // Socket.IO 연결
            this.socket = io({
                transports: ['websocket', 'polling'],
                timeout: 10000
            });
            
            this.socket.on('connect', () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.updateStatus('connected');
                console.log('WebSocket connected');
            });
            
            this.socket.on('disconnect', () => {
                this.isConnected = false;
                this.updateStatus('disconnected');
                this.scheduleReconnect();
            });
            
            this.socket.on('connect_error', () => {
                this.isConnected = false;
                this.updateStatus('error');
            });
            
            this.socket.on('stock_update', (data) => {
                this.handleStockUpdate(data);
            });
            
            this.socket.on('market_status', (data) => {
                SettingsManager.updateMarketStatus(data);
            });
            
        } catch (error) {
            console.warn('WebSocket not available, using polling mode');
            this.updateStatus('polling');
        }
    },
    
    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => {
                console.log(`Reconnecting... Attempt ${this.reconnectAttempts}`);
                this.connect();
            }, this.reconnectDelay * this.reconnectAttempts);
        } else {
            this.updateStatus('polling');
        }
    },
    
    updateStatus(status) {
        const indicator = document.getElementById('wsStatus');
        const badge = document.getElementById('wsModeBadge');
        
        if (!indicator) return;
        
        const statusMap = {
            connected: { text: '실시간 연결됨', class: 'connected', icon: 'fa-bolt' },
            disconnected: { text: '연결 끊김', class: 'disconnected', icon: 'fa-times' },
            error: { text: '연결 오류', class: 'error', icon: 'fa-exclamation' },
            polling: { text: '폴링 모드', class: 'polling', icon: 'fa-sync' }
        };
        
        const s = statusMap[status] || statusMap.polling;
        indicator.innerHTML = `
            <span class="ws-indicator ${s.class}">
                <i class="fas ${s.icon}"></i>
            </span>
            <span class="ws-text">${s.text}</span>
        `;
        
        if (badge) {
            badge.style.display = status === 'connected' ? 'inline-block' : 'none';
        }
    },
    
    handleStockUpdate(data) {
        // 실시간 데이터 업데이트 처리
        if (data.ticker && data.price) {
            const priceElements = document.querySelectorAll(`[data-ticker="${data.ticker}"] .current-price`);
            priceElements.forEach(el => {
                el.textContent = Utils.formatNumber(data.price) + '원';
                el.classList.add('price-updated');
                setTimeout(() => el.classList.remove('price-updated'), 500);
            });
        }
    },
    
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
    }
};

// ========================================
// 앱 초기화
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    // 설정 먼저 로드
    App.loadSettings();
    
    // 각 매니저 초기화
    SearchManager.init();
    SettingsManager.init();
    TabManager.init();
    PortfolioManager.init();
    BacktestManager.init();
    CustomChartsManager.init();
    WebSocketManager.init();
    
    // 메인 데이터 로드
    App.init();
    
    // 전역 함수들 등록
    window.removeCustomChart = (ticker) => CustomChartsManager.removeCustomChart(ticker);
    window.SearchManager = SearchManager;
    window.PortfolioManager = PortfolioManager;
});

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
    App.stopAutoRefresh();
    App.saveSettings();
    WebSocketManager.disconnect();
    
    Object.values(AppState.charts).forEach(chart => {
        if (chart) chart.dispose();
    });
});
