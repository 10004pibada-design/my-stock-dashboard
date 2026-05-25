/**
 * 스마트 주식 대시보드 Pro - 메인 JavaScript
 * 차트 렌더링, 자동 새로고침, 알림, 종목 관리 기능
 */

// ========================================
// 전역 상태 관리
// ========================================
const AppState = {
    tickers: {},        // 현재 표시중인 종목들
    charts: {},         // ECharts 인스턴스
    autoRefreshInterval: null,
    autoRefreshEnabled: true,
    notificationsEnabled: false,
    alertSettings: {
        rsi: true,
        cross: true
    },
    darkMode: false,
    previousSignals: {} // 알림 중복 방지용
};

// 설정 상수
const CONFIG = {
    REFRESH_INTERVAL: 60000,  // 60초
    CHART_HEIGHT: 400,
    NOTIFICATION_DURATION: 5000
};

// ========================================
// 유틸리티 함수
// ========================================
const Utils = {
    formatNumber(num) {
        return new Intl.NumberFormat('ko-KR').format(num);
    },
    
    formatDate(dateStr) {
        return new Date(dateStr).toLocaleDateString('ko-KR', {
            month: 'short',
            day: 'numeric'
        });
    },
    
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },
    
    throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
};

// ========================================
// 알림 시스템
// ========================================
const Notification = {
    async requestPermission() {
        if (!('Notification' in window)) return false;
        if (Notification.permission === 'granted') return true;
        
        const permission = await Notification.requestPermission();
        return permission === 'granted';
    },
    
    browser(title, body, options = {}) {
        if (!AppState.notificationsEnabled || Notification.permission !== 'granted') return;
        
        new Notification(title, {
            body,
            icon: '/static/favicon.ico',
            ...options
        });
    },
    
    toast(title, message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        
        toast.innerHTML = `
            <div class="toast-icon">${icons[type] || icons.info}</div>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" onclick="this.parentElement.remove()">×</button>
        `;
        
        container.appendChild(toast);
        
        // 자동 제거
        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(100%)';
                setTimeout(() => toast.remove(), 300);
            }
        }, CONFIG.NOTIFICATION_DURATION);
    }
};

// ========================================
// API 호출
// ========================================
const API = {
    async fetch(url, options = {}) {
        try {
            const response = await fetch(url, {
                headers: {
                    'Content-Type': 'application/json'
                },
                ...options
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            Notification.toast('오류 발생', error.message, 'error');
            throw error;
        }
    },
    
    async getAllStocks() {
        return this.fetch('/api/stocks');
    },
    
    async getStock(ticker, period = '1y') {
        return this.fetch(`/api/stock/${ticker}?period=${period}`);
    },
    
    async searchStocks(query) {
        return this.fetch(`/api/search?q=${encodeURIComponent(query)}`);
    },
    
    async addTicker(name, ticker) {
        return this.fetch('/api/tickers', {
            method: 'POST',
            body: JSON.stringify({ name, ticker })
        });
    },
    
    async removeTicker(name) {
        return this.fetch('/api/tickers', {
            method: 'DELETE',
            body: JSON.stringify({ name })
        });
    },
    
    async getMarketStatus() {
        return this.fetch('/api/market-status');
    }
};

// ========================================
// 차트 렌더링
// ========================================
const ChartRenderer = {
    render(elementId, data, name) {
        const container = document.getElementById(elementId);
        if (!container) {
            console.error(`Chart container ${elementId} not found`);
            return;
        }
        
        // 기존 차트 dispose
        if (AppState.charts[elementId]) {
            AppState.charts[elementId].dispose();
        }
        
        const chart = echarts.init(container, AppState.darkMode ? 'dark' : undefined);
        AppState.charts[elementId] = chart;
        
        const option = this.getMainChartOption(data, name);
        chart.setOption(option);
        
        // 리사이즈 이벤트
        window.addEventListener('resize', () => chart.resize());
        
        return chart;
    },
    
    getMainChartOption(data, name) {
        const isDark = AppState.darkMode;
        const textColor = isDark ? '#94a3b8' : '#64748b';
        const gridColor = isDark ? '#334155' : '#e2e8f0';
        
        return {
            animation: true,
            animationDuration: 1000,
            backgroundColor: 'transparent',
            title: {
                text: `${name} 차트`,
                left: 'center',
                textStyle: {
                    fontSize: 14,
                    fontWeight: 'bold',
                    color: isDark ? '#f1f5f9' : '#1e293b'
                }
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
                backgroundColor: isDark ? '#1e293b' : '#ffffff',
                borderColor: gridColor,
                textStyle: { color: isDark ? '#f1f5f9' : '#1e293b' },
                formatter: function(params) {
                    return ChartRenderer.tooltipFormatter(params, data);
                }
            },
            legend: {
                data: ['캔들차트', 'MA20', 'MA60', '볼린저상단', '볼린저하단', '거래량'],
                top: 30,
                textStyle: { color: textColor }
            },
            grid: [
                { left: '3%', right: '3%', top: '15%', height: '50%' },
                { left: '3%', right: '3%', top: '72%', height: '15%' }
            ],
            xAxis: [
                {
                    type: 'category',
                    data: data.dates,
                    gridIndex: 0,
                    boundaryGap: true,
                    axisLine: { lineStyle: { color: gridColor } },
                    axisLabel: { color: textColor, fontSize: 11 }
                },
                {
                    type: 'category',
                    data: data.dates,
                    gridIndex: 1,
                    boundaryGap: true,
                    show: false
                }
            ],
            yAxis: [
                {
                    scale: true,
                    gridIndex: 0,
                    axisLine: { show: false },
                    axisLabel: {
                        color: textColor,
                        formatter: value => Utils.formatNumber(Math.round(value))
                    },
                    splitLine: { lineStyle: { color: gridColor, type: 'dashed' } }
                },
                {
                    scale: true,
                    gridIndex: 1,
                    splitNumber: 2,
                    axisLabel: { show: false },
                    axisLine: { show: false },
                    splitLine: { show: false }
                }
            ],
            dataZoom: [
                {
                    type: 'inside',
                    xAxisIndex: [0, 1],
                    start: 50,
                    end: 100
                },
                {
                    show: true,
                    type: 'slider',
                    xAxisIndex: [0, 1],
                    top: '90%',
                    start: 50,
                    end: 100,
                    height: 20,
                    borderColor: gridColor,
                    fillerColor: isDark ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.1)',
                    handleStyle: { color: '#3b82f6' }
                }
            ],
            series: [
                {
                    name: '캔들차트',
                    type: 'candlestick',
                    data: data.kline,
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    itemStyle: {
                        color: '#ef4444',
                        color0: '#3b82f6',
                        borderColor: '#ef4444',
                        borderColor0: '#3b82f6',
                        borderWidth: 1
                    }
                },
                {
                    name: 'MA20',
                    type: 'line',
                    data: data.ma20,
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    smooth: true,
                    lineStyle: { color: '#f59e0b', width: 2 },
                    symbol: 'none'
                },
                {
                    name: 'MA60',
                    type: 'line',
                    data: data.ma60,
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    smooth: true,
                    lineStyle: { color: '#8b5cf6', width: 2 },
                    symbol: 'none'
                },
                {
                    name: '볼린저상단',
                    type: 'line',
                    data: data.bollinger?.upper || [],
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    smooth: true,
                    lineStyle: { color: '#10b981', width: 1, type: 'dashed', opacity: 0.6 },
                    symbol: 'none'
                },
                {
                    name: '볼린저하단',
                    type: 'line',
                    data: data.bollinger?.lower || [],
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    smooth: true,
                    lineStyle: { color: '#10b981', width: 1, type: 'dashed', opacity: 0.6 },
                    symbol: 'none'
                },
                {
                    name: '거래량',
                    type: 'bar',
                    data: data.volumes,
                    xAxisIndex: 1,
                    yAxisIndex: 1,
                    itemStyle: {
                        color: params => {
                            const kline = data.kline[params.dataIndex];
                            return kline && kline[1] >= kline[0] 
                                ? 'rgba(59, 130, 246, 0.6)' 
                                : 'rgba(239, 68, 68, 0.6)';
                        }
                    }
                }
            ]
        };
    },
    
    tooltipFormatter(params, data) {
        let result = `<strong>${params[0].axisValue}</strong><br/>`;
        
        params.forEach(item => {
            if (item.seriesName === '캔들차트') {
                const candleData = item.data;
                result += `
                    <div style="margin: 4px 0;">
                        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f59e0b;margin-right:5px;"></span>
                        <strong>시가:</strong> ${Utils.formatNumber(Math.round(candleData[1]))}원<br/>
                        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;margin-right:5px;"></span>
                        <strong>종가:</strong> ${Utils.formatNumber(Math.round(candleData[2]))}원<br/>
                        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#3b82f6;margin-right:5px;"></span>
                        <strong>저가:</strong> ${Utils.formatNumber(Math.round(candleData[3]))}원<br/>
                        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#10b981;margin-right:5px;"></span>
                        <strong>고가:</strong> ${Utils.formatNumber(Math.round(candleData[4]))}원
                    </div>
                `;
            } else if (item.seriesName === '거래량') {
                result += `<div>${item.marker} <strong>거래량:</strong> ${Utils.formatNumber(item.data)}주</div>`;
            } else {
                result += `<div>${item.marker} <strong>${item.seriesName}:</strong> ${Utils.formatNumber(Math.round(item.data))}</div>`;
            }
        });
        
        // RSI 표시
        if (data.rsi && data.rsi[params[0].dataIndex] !== undefined) {
            const rsi = data.rsi[params[0].dataIndex];
            const rsiColor = rsi > 70 ? '#ef4444' : rsi < 30 ? '#10b981' : '#f59e0b';
            result += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid #eee;"><strong>RSI:</strong> <span style="color:${rsiColor};font-weight:bold;">${rsi.toFixed(2)}</span></div>`;
        }
        
        return result;
    }
};

// ========================================
// 종목 카드 렌더링
// ========================================
const StockCard = {
    create(ticker, data) {
        const changeClass = data.change_pct > 0 ? 'up' : data.change_pct < 0 ? 'down' : 'neutral';
        const changeIcon = data.change_pct > 0 ? '▲' : data.change_pct < 0 ? '▼' : '-';
        
        const card = document.createElement('div');
        card.className = 'stock-card';
        card.id = `card-${ticker.replace(/\./g, '_')}`;
        
        card.innerHTML = `
            <div class="card-header">
                <div class="card-title-section">
                    <div class="card-title">
                        ${data.name}
                        <span class="card-code">${ticker}</span>
                    </div>
                </div>
                <div class="card-actions">
                    <div class="change-badge ${changeClass}">
                        ${changeIcon} ${Math.abs(data.change_pct).toFixed(2)}%
                    </div>
                    <button class="btn-delete" onclick="StockCard.remove('${ticker}', '${data.name}')" title="삭제">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>
            
            <div class="card-kpi-grid">
                <div class="kpi-item">
                    <div class="kpi-label">현재가</div>
                    <div class="kpi-value ${changeClass}">
                        ${Utils.formatNumber(Math.round(data.latest_price))}
                        <span class="unit">원</span>
                    </div>
                </div>
                <div class="kpi-item">
                    <div class="kpi-label">거래량</div>
                    <div class="kpi-value">
                        ${Utils.formatNumber(data.latest_vol)}
                        <span class="unit">주</span>
                    </div>
                </div>
                <div class="kpi-item">
                    <div class="kpi-label">20일선</div>
                    <div class="kpi-value ma20">
                        ${Utils.formatNumber(Math.round(data.ma20[data.ma20.length - 1]))}
                    </div>
                </div>
                <div class="kpi-item">
                    <div class="kpi-label">60일선</div>
                    <div class="kpi-value ma60">
                        ${Utils.formatNumber(Math.round(data.ma60[data.ma60.length - 1]))}
                    </div>
                </div>
            </div>
            
            <div class="signal-box ${data.signal_class}">
                <div class="signal-icon">${this.getSignalIcon(data.signal_class)}</div>
                <div class="signal-content">
                    <div class="signal-title">${data.signal_text}</div>
                    <div class="signal-reason">${data.signal_reason}</div>
                </div>
            </div>
            
            <div class="chart-container">
                <div id="chart-${ticker.replace(/\./g, '_')}" class="chart"></div>
            </div>
        `;
        
        return card;
    },
    
    getSignalIcon(signalClass) {
        const icons = {
            buy: '📈',
            sell: '📉',
            hold: '⚖️',
            caution: '⚠️',
            neutral: '○'
        };
        return icons[signalClass] || icons.neutral;
    },
    
    async remove(ticker, name) {
        if (!confirm(`${name}(${ticker}) 종목을 삭제할까요?`)) return;
        
        try {
            await API.removeTicker(name);
            
            // UI에서 제거
            const card = document.getElementById(`card-${ticker.replace(/\./g, '_')}`);
            if (card) {
                card.style.opacity = '0';
                card.style.transform = 'scale(0.95)';
                setTimeout(() => card.remove(), 300);
            }
            
            // 차트 인스턴스 정리
            if (AppState.charts[`chart-${ticker.replace(/\./g, '_')}`]) {
                delete AppState.charts[`chart-${ticker.replace(/\./g, '_')}`];
            }
            
            delete AppState.tickers[ticker];
            Notification.toast('삭제 완료', `${name}가 관심 종목에서 제거되었습니다.`, 'success');
            
        } catch (error) {
            console.error('Remove error:', error);
        }
    },
    
    checkAlerts(ticker, data) {
        const prevSignal = AppState.previousSignals[ticker];
        const currentSignal = data.signal_class;
        
        // 신호 변경 시 알림
        if (prevSignal && prevSignal !== currentSignal) {
            const signalNames = {
                buy: '매수',
                sell: '매도',
                hold: '보유',
                caution: '주의'
            };
            
            Notification.browser(
                `${data.name} - ${signalNames[currentSignal]} 신호`,
                data.signal_reason
            );
            Notification.toast(
                '신호 변경',
                `${data.name}: ${signalNames[currentSignal]} 신호가 발생했습니다`,
                currentSignal === 'buy' ? 'success' : currentSignal === 'sell' ? 'warning' : 'info'
            );
        }
        
        // RSI 과매수/과매도 알림
        if (AppState.alertSettings.rsi && data.rsi_value !== null) {
            const prevRSI = AppState.previousSignals[`${ticker}_rsi`];
            const currentRSI = data.rsi_value;
            
            if (currentRSI > 70 && (!prevRSI || prevRSI <= 70)) {
                Notification.browser(
                    `${data.name} - RSI 과매수`,
                    `RSI가 ${currentRSI.toFixed(2)}로 과매수 구간에 진입했습니다.`
                );
            } else if (currentRSI < 30 && (!prevRSI || prevRSI >= 30)) {
                Notification.browser(
                    `${data.name} - RSI 과매도`,
                    `RSI가 ${currentRSI.toFixed(2)}로 과매도 구간에 진입했습니다.`
                );
            }
            
            AppState.previousSignals[`${ticker}_rsi`] = currentRSI;
        }
        
        AppState.previousSignals[ticker] = currentSignal;
    }
};

// ========================================
// 검색 및 추가
// ========================================
const SearchManager = {
    init() {
        const searchInput = document.getElementById('stockSearch');
        const searchBtn = document.getElementById('searchBtn');
        
        // 검색 입력 이벤트
        searchInput.addEventListener('input', Utils.debounce(() => {
            this.performSearch(searchInput.value.trim());
        }, 500));
        
        // 검색 버튼
        searchBtn.addEventListener('click', () => {
            this.performSearch(searchInput.value.trim());
        });
        
        // Enter 키
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.performSearch(searchInput.value.trim());
            }
        });
        
        // 퀵 추가 칩
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
                
                // 새 카드 추가
                if (result.data) {
                    result.data.name = name;
                    this.addStockCard(ticker, result.data);
                }
                
                // 검색창 초기화
                document.getElementById('stockSearch').value = '';
                this.hideResults();
                
                // 전체 새로고침
                setTimeout(() => App.loadStocks(), 1000);
            } else {
                Notification.toast('추가 실패', result.error || '종목을 추가할 수 없습니다.', 'error');
            }
        } catch (error) {
            Notification.toast('오류', '종목 추가 중 오류가 발생했습니다.', 'error');
        }
    },
    
    addStockCard(ticker, data) {
        const grid = document.getElementById('stocksGrid');
        const card = StockCard.create(ticker, data);
        grid.appendChild(card);
        
        // 차트 렌더링
        setTimeout(() => {
            ChartRenderer.render(`chart-${ticker.replace(/\./g, '_')}`, data, data.name);
        }, 100);
    }
};

// ========================================
// 설정 관리
// ========================================
const SettingsManager = {
    init() {
        // 테마 토글
        const themeToggle = document.getElementById('themeToggle');
        themeToggle.addEventListener('click', () => this.toggleTheme());
        
        // 설정 패널
        const settingsBtn = document.getElementById('settingsBtn');
        const notificationSection = document.getElementById('notificationSection');
        settingsBtn.addEventListener('click', () => {
            notificationSection.style.display = 
                notificationSection.style.display === 'none' ? 'block' : 'none';
        });
        
        // 알림 설정
        const notifEnabled = document.getElementById('notifEnabled');
        notifEnabled.addEventListener('change', async () => {
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
        
        // 자동 새로고침
        const autoRefresh = document.getElementById('autoRefresh');
        autoRefresh.addEventListener('change', () => {
            AppState.autoRefreshEnabled = autoRefresh.checked;
            if (autoRefresh.checked) {
                App.startAutoRefresh();
            } else {
                App.stopAutoRefresh();
            }
            this.updateRefreshIndicator();
        });
        
        // RSI 알림
        const rsiAlert = document.getElementById('rsiAlert');
        rsiAlert.addEventListener('change', () => {
            AppState.alertSettings.rsi = rsiAlert.checked;
        });
        
        // 크로스 알림
        const crossAlert = document.getElementById('crossAlert');
        crossAlert.addEventListener('change', () => {
            AppState.alertSettings.cross = crossAlert.checked;
        });
        
        // 수동 새로고침
        const refreshBtn = document.getElementById('refreshBtn');
        refreshBtn.addEventListener('click', () => {
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
        icon.className = AppState.darkMode ? 'fas fa-sun' : 'fas fa-moon';
        
        // 모든 차트 테마 업데이트
        Object.keys(AppState.charts).forEach(chartId => {
            const chart = AppState.charts[chartId];
            if (chart) {
                const ticker = chartId.replace('chart-', '').replace(/_/g, '.');
                const data = AppState.tickers[ticker];
                if (data) {
                    ChartRenderer.render(chartId, data, data.name);
                }
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
        const dot = statusEl.querySelector('.status-dot');
        const text = statusEl.querySelector('.status-text');
        
        if (status.is_market_open) {
            dot.classList.add('open');
            text.textContent = '장중';
        } else {
            dot.classList.remove('open');
            text.textContent = '장마감';
        }
    }
};

// ========================================
// 메인 앱
// ========================================
const App = {
    async init() {
        // 상태 초기화
        this.loadSettings();
        
        // 이벤트 리스너 초기화
        SearchManager.init();
        SettingsManager.init();
        
        // 초기 데이터 로드
        await this.loadStocks();
        
        // 시장 상태 확인
        this.updateMarketStatus();
        
        // 자동 새로고침 시작
        if (AppState.autoRefreshEnabled) {
            this.startAutoRefresh();
        }
        
        // 주기적 시장 상태 업데이트
        setInterval(() => this.updateMarketStatus(), 60000);
    },
    
    loadSettings() {
        // 로컬 스토리지에서 설정 로드
        const saved = localStorage.getItem('stockDashboardSettings');
        if (saved) {
            const settings = JSON.parse(saved);
            AppState.darkMode = settings.darkMode || false;
            AppState.notificationsEnabled = settings.notificationsEnabled || false;
            AppState.autoRefreshEnabled = settings.autoRefreshEnabled !== false;
            AppState.alertSettings = settings.alertSettings || { rsi: true, cross: true };
        }
        
        // UI에 설정 반영
        document.documentElement.setAttribute('data-theme', AppState.darkMode ? 'dark' : 'light');
        document.getElementById('autoRefresh').checked = AppState.autoRefreshEnabled;
        document.getElementById('rsiAlert').checked = AppState.alertSettings.rsi;
        document.getElementById('crossAlert').checked = AppState.alertSettings.cross;
        
        const themeIcon = document.querySelector('#themeToggle i');
        if (themeIcon) {
            themeIcon.className = AppState.darkMode ? 'fas fa-sun' : 'fas fa-moon';
        }
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
                
                // 업데이트 시간 표시
                document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('ko-KR');
            }
        } catch (error) {
            Notification.toast('데이터 로드 실패', '주식 데이터를 불러오는데 실패했습니다.', 'error');
        }
    },
    
    renderStocks(stocks) {
        const grid = document.getElementById('stocksGrid');
        
        // 스켈레톤 제거
        const skeleton = grid.querySelector('.loading-skeleton');
        if (skeleton) skeleton.remove();
        
        // 기존 카드 업데이트 또는 새로 생성
        Object.entries(stocks).forEach(([ticker, data]) => {
            const cardId = `card-${ticker.replace(/\./g, '_')}`;
            let card = document.getElementById(cardId);
            
            if (!card) {
                card = StockCard.create(ticker, data);
                grid.appendChild(card);
                
                // 차트 렌더링
                setTimeout(() => {
                    ChartRenderer.render(`chart-${ticker.replace(/\./g, '_')}`, data, data.name);
                }, 100);
            } else {
                // 기존 카드 업데이트
                this.updateCard(card, data);
            }
            
            // 알림 체크
            StockCard.checkAlerts(ticker, data);
        });
    },
    
    updateCard(card, data) {
        // KPI 값 업데이트
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
        
        // 등락률 업데이트
        const changeBadge = card.querySelector('.change-badge');
        if (changeBadge) {
            const changeClass = data.change_pct > 0 ? 'up' : data.change_pct < 0 ? 'down' : 'neutral';
            const changeIcon = data.change_pct > 0 ? '▲' : data.change_pct < 0 ? '▼' : '-';
            changeBadge.className = `change-badge ${changeClass}`;
            changeBadge.innerHTML = `${changeIcon} ${Math.abs(data.change_pct).toFixed(2)}%`;
        }
        
        // 시그널 업데이트
        const signalBox = card.querySelector('.signal-box');
        if (signalBox) {
            signalBox.className = `signal-box ${data.signal_class}`;
            signalBox.querySelector('.signal-icon').textContent = StockCard.getSignalIcon(data.signal_class);
            signalBox.querySelector('.signal-title').textContent = data.signal_text;
            signalBox.querySelector('.signal-reason').textContent = data.signal_reason;
        }
        
        // 차트 업데이트 (있는 경우)
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

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
    App.stopAutoRefresh();
    App.saveSettings();
    
    // 모든 차트 정리
    Object.values(AppState.charts).forEach(chart => {
        if (chart) chart.dispose();
    });
});

// DOM 로드 완료 후 초기화
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// 전역 함수 노출 (HTML에서 사용)
window.SearchManager = SearchManager;
window.StockCard = StockCard;
