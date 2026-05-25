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

// ========================================
// 포트폴리오 관리
// ========================================
const PortfolioManager = {
    holdings: [],
    summary: {},
    
    init() {
        this.loadPortfolio();
        this.setupEventListeners();
    },
    
    setupEventListeners() {
        // 포트폴리오 토글 버튼
        const toggleBtn = document.getElementById('togglePortfolioBtn');
        const content = document.getElementById('portfolioContent');
        
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                content.classList.toggle('collapsed');
                toggleBtn.classList.toggle('collapsed');
            });
        }
        
        // 종목 추가 버튼
        const addBtn = document.getElementById('addPortfolioBtn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.addHolding());
        }
        
        // 포트폴리오 헤더 클릭으로도 토글
        const header = document.querySelector('.portfolio-header');
        if (header) {
            header.addEventListener('click', (e) => {
                if (e.target.closest('.btn-toggle')) return; // 버튼 클릭은 중복 방지
                content.classList.toggle('collapsed');
                if (toggleBtn) toggleBtn.classList.toggle('collapsed');
            });
        }
    },
    
    async loadPortfolio() {
        try {
            const response = await fetch('/api/portfolio');
            const result = await response.json();
            
            if (result.success) {
                this.holdings = result.data.holdings || [];
                this.summary = result.data.summary || {};
                this.renderPortfolio();
            }
        } catch (error) {
            console.error('Error loading portfolio:', error);
        }
    },
    
    renderPortfolio() {
        // 요약 정보 업데이트
        const totalInvestedEl = document.getElementById('totalInvested');
        const currentValueEl = document.getElementById('currentValue');
        const totalReturnEl = document.getElementById('totalReturn');
        
        if (totalInvestedEl) {
            totalInvestedEl.textContent = this.summary.total_invested 
                ? Utils.formatNumber(this.summary.total_invested) + '원'
                : '-';
        }
        
        if (currentValueEl) {
            currentValueEl.textContent = this.summary.current_value 
                ? Utils.formatNumber(this.summary.current_value) + '원'
                : '-';
        }
        
        if (totalReturnEl) {
            const returnPct = this.summary.return_pct || 0;
            const isPositive = returnPct >= 0;
            totalReturnEl.textContent = `${isPositive ? '+' : ''}${returnPct.toFixed(2)}%`;
            totalReturnEl.className = isPositive ? 'value profit-positive' : 'value profit-negative';
        }
        
        // 테이블 업데이트
        const tbody = document.getElementById('portfolioTableBody');
        if (!tbody) return;
        
        if (this.holdings.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="8">보유 종목이 없습니다. 종목을 추가하세요.</td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = this.holdings.map(holding => {
            const isProfit = holding.profit_loss >= 0;
            const profitClass = isProfit ? 'profit-positive' : 'profit-negative';
            const profitIcon = isProfit ? '▲' : '▼';
            
            return `
                <tr data-id="${holding.id}">
                    <td>
                        <strong>${holding.name}</strong>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${holding.ticker}</div>
                    </td>
                    <td>${Utils.formatNumber(holding.shares)}주</td>
                    <td>${Utils.formatNumber(Math.round(holding.avg_price))}원</td>
                    <td>${Utils.formatNumber(Math.round(holding.current_price || 0))}원</td>
                    <td>${Utils.formatNumber(Math.round(holding.current_value || 0))}원</td>
                    <td class="${profitClass}">${profitIcon} ${Utils.formatNumber(Math.abs(Math.round(holding.profit_loss || 0)))}원</td>
                    <td class="${profitClass}">${profitIcon} ${Math.abs(holding.return_pct || 0).toFixed(2)}%</td>
                    <td>
                        <button class="btn-small btn-delete-small" onclick="PortfolioManager.removeHolding('${holding.id}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },
    
    async addHolding() {
        const tickerInput = document.getElementById('portfolioTicker');
        const nameInput = document.getElementById('portfolioName');
        const sharesInput = document.getElementById('portfolioShares');
        const priceInput = document.getElementById('portfolioPrice');
        
        const ticker = tickerInput?.value?.trim();
        const name = nameInput?.value?.trim();
        const shares = parseFloat(sharesInput?.value);
        const avgPrice = parseFloat(priceInput?.value);
        
        if (!ticker || !name || !shares || !avgPrice) {
            Notification.toast('입력 오류', '모든 필드를 입력해주세요.', 'warning');
            return;
        }
        
        try {
            const response = await fetch('/api/portfolio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ticker: ticker,
                    name: name,
                    shares: shares,
                    avg_price: avgPrice
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                Notification.toast('추가 완료', result.message, 'success');
                
                // 입력 초기화
                tickerInput.value = '';
                nameInput.value = '';
                sharesInput.value = '';
                priceInput.value = '';
                
                // 포트폴리오 다시 로드
                await this.loadPortfolio();
                
                // 관심 종목에도 자동 추가
                await SearchManager.addStock(name, ticker);
            } else {
                Notification.toast('추가 실패', result.error || '종목을 추가할 수 없습니다.', 'error');
            }
        } catch (error) {
            Notification.toast('오류', '종목 추가 중 오류가 발생했습니다.', 'error');
        }
    },
    
    async removeHolding(holdingId) {
        if (!confirm('해당 종목을 포트폴리오에서 삭제하시겠습니까?')) return;
        
        try {
            const response = await fetch(`/api/portfolio/${holdingId}`, {
                method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (result.success) {
                Notification.toast('삭제 완료', result.message, 'success');
                await this.loadPortfolio();
            } else {
                Notification.toast('삭제 실패', result.error || '종목을 삭제할 수 없습니다.', 'error');
            }
        } catch (error) {
            Notification.toast('오류', '종목 삭제 중 오류가 발생했습니다.', 'error');
        }
    }
};

// ========================================
// 백테스팅 관리
// ========================================
const BacktestManager = {
    chart: null,
    
    init() {
        this.setupEventListeners();
    },
    
    setupEventListeners() {
        // 토글 버튼
        const toggleBtn = document.getElementById('toggleBacktestBtn');
        const content = document.getElementById('backtestContent');
        
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                content.classList.toggle('collapsed');
                toggleBtn.classList.toggle('collapsed');
            });
        }
        
        // 헤더 클릭으로도 토글
        const header = document.querySelector('.backtest-header');
        if (header) {
            header.addEventListener('click', (e) => {
                if (e.target.closest('.btn-toggle')) return;
                content.classList.toggle('collapsed');
                if (toggleBtn) toggleBtn.classList.toggle('collapsed');
            });
        }
        
        // 백테스트 실행 버튼
        const runBtn = document.getElementById('runBacktestBtn');
        if (runBtn) {
            runBtn.addEventListener('click', () => this.runBacktest());
        }
    },
    
    async runBacktest() {
        const ticker = document.getElementById('backtestTicker').value.trim();
        const period = document.getElementById('backtestPeriod').value;
        
        if (!ticker) {
            Notification.toast('입력 오류', '종목코드를 입력해주세요.', 'warning');
            return;
        }
        
        Notification.toast('백테스트 실행 중', '과거 데이터를 분석하고 있습니다...', 'info');
        
        try {
            const response = await fetch(`/api/backtest/${ticker}?period=${period}`);
            const result = await response.json();
            
            if (result.success) {
                this.displayResults(result.data);
                Notification.toast('백테스트 완료', '분석 결과를 확인하세요!', 'success');
            } else {
                Notification.toast('백테스트 실패', result.error || '분석 중 오류가 발생했습니다.', 'error');
            }
        } catch (error) {
            Notification.toast('오류', '백테스트 실행 중 오류가 발생했습니다.', 'error');
        }
    },
    
    displayResults(data) {
        const resultsSection = document.getElementById('backtestResults');
        const summaryDiv = document.getElementById('backtestSummary');
        const tradesBody = document.getElementById('tradesTableBody');
        
        resultsSection.style.display = 'block';
        
        // 요약 카드 렌더링
        const stats = data;
        summaryDiv.innerHTML = `
            <div class="summary-card">
                <span class="label">총 거래 횟수</span>
                <span class="value">${stats.total_trades}회</span>
            </div>
            <div class="summary-card">
                <span class="label">승률</span>
                <span class="value">${stats.win_rate}%</span>
            </div>
            <div class="summary-card">
                <span class="label">총 수익률</span>
                <span class="value ${stats.total_profit_pct >= 0 ? 'positive' : 'negative'}">
                    ${stats.total_profit_pct >= 0 ? '+' : ''}${stats.total_profit_pct}%
                </span>
            </div>
            <div class="summary-card">
                <span class="label">평균 수익/거래</span>
                <span class="value ${stats.avg_profit_per_trade >= 0 ? 'positive' : 'negative'}">
                    ${stats.avg_profit_per_trade >= 0 ? '+' : ''}${stats.avg_profit_per_trade}%
                </span>
            </div>
            <div class="summary-card">
                <span class="label">최대 낙폭</span>
                <span class="value">${stats.max_drawdown}%</span>
            </div>
            <div class="summary-card">
                <span class="label">샤프 비율</span>
                <span class="value">${stats.sharpe_ratio}</span>
            </div>
        `;
        
        // 차트 렌더링
        this.renderEquityChart(data.equity_curve);
        
        // 거래 내역 렌더링
        if (data.trades && data.trades.length > 0) {
            tradesBody.innerHTML = data.trades.map(trade => {
                const isProfit = trade.profit >= 0;
                const profitClass = isProfit ? 'profit-positive' : 'profit-negative';
                const profitIcon = isProfit ? '▲' : '▼';
                
                return `
                    <tr>
                        <td>${trade.entry_date}</td>
                        <td>${Utils.formatNumber(Math.round(trade.entry_price))}원</td>
                        <td>${trade.exit_date}</td>
                        <td>${Utils.formatNumber(Math.round(trade.exit_price))}원</td>
                        <td class="${profitClass}">${profitIcon} ${Utils.formatNumber(Math.abs(Math.round(trade.profit)))}원</td>
                        <td class="${profitClass}">${profitIcon} ${Math.abs(trade.profit_pct).toFixed(2)}%</td>
                    </tr>
                `;
            }).join('');
        } else {
            tradesBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">거래 내역이 없습니다.</td></tr>';
        }
    },
    
    renderEquityChart(equityData) {
        const chartContainer = document.getElementById('backtestChart');
        if (!chartContainer) return;
        
        if (this.chart) {
            this.chart.dispose();
        }
        
        this.chart = echarts.init(chartContainer, AppState.darkMode ? 'dark' : undefined);
        
        const dates = equityData.map(d => d.date);
        const equities = equityData.map(d => d.equity);
        const prices = equityData.map(d => d.price);
        
        const option = {
            animation: true,
            backgroundColor: 'transparent',
            title: {
                text: '자산 곡선',
                left: 'center',
                textStyle: { fontSize: 14 }
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' }
            },
            legend: {
                data: ['자산 가치', '주가'],
                top: 30
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '3%',
                top: '20%',
                containLabel: true
            },
            xAxis: {
                type: 'category',
                data: dates,
                axisLabel: { fontSize: 10, rotate: 45 }
            },
            yAxis: [
                {
                    type: 'value',
                    name: '자산',
                    axisLabel: {
                        formatter: value => (value / 1000000).toFixed(1) + 'M'
                    }
                },
                {
                    type: 'value',
                    name: '주가',
                    axisLabel: {
                        formatter: value => value.toLocaleString()
                    }
                }
            ],
            series: [
                {
                    name: '자산 가치',
                    type: 'line',
                    data: equities,
                    smooth: true,
                    lineStyle: { color: '#3b82f6', width: 2 },
                    itemStyle: { color: '#3b82f6' }
                },
                {
                    name: '주가',
                    type: 'line',
                    yAxisIndex: 1,
                    data: prices,
                    smooth: true,
                    lineStyle: { color: '#10b981', width: 1, opacity: 0.7 },
                    itemStyle: { color: '#10b981' }
                }
            ]
        };
        
        this.chart.setOption(option);
        
        window.addEventListener('resize', () => this.chart.resize());
    }
};

// ========================================
// WebSocket / Socket.IO 실시간 연결
// ========================================
const WebSocketManager = {
    socket: null,
    connected: false,
    subscribedTickers: new Set(),
    
    init() {
        this.connect();
    },
    
    connect() {
        try {
            // Socket.IO 연결
            this.socket = io(window.location.origin, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000
            });
            
            this.socket.on('connect', () => {
                console.log('[WebSocket] Connected to server');
                this.connected = true;
                this.updateStatus('connected');
                Notification.toast('실시간 연결됨', '실시간 시세 스트리밍이 시작되었습니다.', 'success');
                
                // 현재 표시된 모든 종목 구독
                Object.keys(AppState.tickers).forEach(ticker => {
                    this.subscribe(ticker);
                });
                
                // 실시간 모드 UI 활성화
                document.getElementById('wsModeBadge').style.display = 'inline-flex';
            });
            
            this.socket.on('disconnect', (reason) => {
                console.log('[WebSocket] Disconnected:', reason);
                this.connected = false;
                this.updateStatus('disconnected');
                document.getElementById('wsModeBadge').style.display = 'none';
            });
            
            this.socket.on('connect_error', (error) => {
                console.log('[WebSocket] Connection error:', error);
                this.updateStatus('error');
            });
            
            // 실시간 가격 업데이트 수신
            this.socket.on('price_update', (data) => {
                this.handlePriceUpdate(data);
            });
            
            // 기타 이벤트
            this.socket.on('subscribed', (data) => {
                console.log('[WebSocket] Subscribed:', data);
            });
            
            this.socket.on('broadcast', (data) => {
                console.log('[WebSocket] Broadcast:', data);
            });
            
        } catch (error) {
            console.error('[WebSocket] Init error:', error);
            this.updateStatus('error');
        }
    },
    
    subscribe(ticker) {
        if (this.socket && this.connected && !this.subscribedTickers.has(ticker)) {
            this.socket.emit('subscribe', { ticker });
            this.subscribedTickers.add(ticker);
        }
    },
    
    unsubscribe(ticker) {
        if (this.socket && this.connected && this.subscribedTickers.has(ticker)) {
            this.socket.emit('unsubscribe', { ticker });
            this.subscribedTickers.delete(ticker);
        }
    },
    
    handlePriceUpdate(data) {
        // 실시간 가격 업데이트 처리
        const { ticker, price, change_pct, volume, timestamp } = data;
        
        // AppState에 업데이트
        if (AppState.tickers[ticker]) {
            const tickerData = AppState.tickers[ticker];
            tickerData.latest_price = price;
            tickerData.change_pct = change_pct;
            tickerData.latest_vol = volume;
            tickerData.updated_at = timestamp;
            
            // UI 업데이트
            const cardId = `card-${ticker.replace(/\./g, '_')}`;
            const card = document.getElementById(cardId);
            if (card) {
                // 현재가 업데이트
                const kpiValues = card.querySelectorAll('.kpi-value');
                if (kpiValues[0]) {
                    const changeClass = change_pct > 0 ? 'up' : change_pct < 0 ? 'down' : 'neutral';
                    kpiValues[0].className = `kpi-value ${changeClass}`;
                    kpiValues[0].innerHTML = `${Utils.formatNumber(Math.round(price))}<span class="unit">원</span>`;
                    
                    // 깜빡임 효과 추가
                    kpiValues[0].classList.add('price-flash');
                    setTimeout(() => kpiValues[0].classList.remove('price-flash'), 500);
                }
                
                // 거래량 업데이트
                if (kpiValues[1]) {
                    kpiValues[1].innerHTML = `${Utils.formatNumber(volume)}<span class="unit">주</span>`;
                }
                
                // 등락률 배지 업데이트
                const changeBadge = card.querySelector('.change-badge');
                if (changeBadge) {
                    const changeClass = change_pct > 0 ? 'up' : change_pct < 0 ? 'down' : 'neutral';
                    const changeIcon = change_pct > 0 ? '▲' : change_pct < 0 ? '▼' : '-';
                    changeBadge.className = `change-badge ${changeClass}`;
                    changeBadge.innerHTML = `${changeIcon} ${Math.abs(change_pct).toFixed(2)}%`;
                }
            }
            
            // 마지막 업데이트 시간 갱신
            document.getElementById('lastUpdate').textContent = new Date(timestamp).toLocaleTimeString('ko-KR');
        }
    },
    
    updateStatus(status) {
        const wsStatus = document.getElementById('wsStatus');
        const indicator = wsStatus.querySelector('.ws-indicator');
        const text = wsStatus.querySelector('.ws-text');
        
        indicator.classList.remove('connected', 'disconnected', 'error');
        
        switch (status) {
            case 'connected':
                indicator.classList.add('connected');
                text.textContent = '실시간 연결 중';
                break;
            case 'disconnected':
                indicator.classList.add('disconnected');
                text.textContent = '연결 끊김';
                break;
            case 'error':
                indicator.classList.add('error');
                text.textContent = '연결 오류';
                break;
            default:
                indicator.classList.add('disconnected');
                text.textContent = '연결 중...';
        }
    },
    
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
    }
};

// ========================================
// 앱 초기화 시 WebSocket 연결 및 포트폴리오 로드
// ========================================
// DOM 로드 완료 후 초기화
const originalInit = App.init;
App.init = async function() {
    await originalInit.call(this);
    // 포트폴리오 초기화
    PortfolioManager.init();
    // 백테스팅 초기화
    BacktestManager.init();
    // WebSocket 초기화
    WebSocketManager.init();
};

// 종목 추가 시 WebSocket 구독
const originalAddStock = SearchManager.addStock;
SearchManager.addStock = async function(name, ticker) {
    await originalAddStock.call(this, name, ticker);
    WebSocketManager.subscribe(ticker);
};

// 종목 삭제 시 WebSocket 구독 취소
const originalRemove = StockCard.remove;
StockCard.remove = async function(ticker, name) {
    WebSocketManager.unsubscribe(ticker);
    await originalRemove.call(this, ticker, name);
};

// ========================================
// 추가 차트 관리 (Custom Charts)
// ========================================
const CustomChartsManager = {
    customTickers: [], // {ticker, name, addedAt}
    charts: {},        // ECharts 인스턴스 저장
    
    init() {
        this.loadCustomCharts();
        this.bindEvents();
        this.renderAllCharts();
    },
    
    loadCustomCharts() {
        const saved = localStorage.getItem('customCharts');
        if (saved) {
            this.customTickers = JSON.parse(saved);
        }
        this.updateUI();
    },
    
    saveCustomCharts() {
        localStorage.setItem('customCharts', JSON.stringify(this.customTickers));
        this.updateUI();
    },
    
    bindEvents() {
        // 추가 버튼 클릭
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
        
        // 추천 종목 칩 클릭
        document.querySelectorAll('.custom-chips-section .chip, .custom-charts-form .chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const code = chip.dataset.code;
                const name = chip.textContent;
                this.addCustomChartWithName(code, name);
            });
        });
    },
    
    async addCustomChart() {
        const input = document.getElementById('customTickerInput');
        const ticker = input.value.trim().toUpperCase();
        
        if (!ticker) {
            Notification.toast('입력 오류', '종목코드를 입력해 주세요.', 'error');
            return;
        }
        
        // 중복 체크
        if (this.customTickers.some(t => t.ticker === ticker)) {
            Notification.toast('중복 오류', '이미 추가된 종목입니다.', 'error');
            return;
        }
        
        // 종목 정보 가져오기
        try {
            const response = await fetch(`/api/stock/${ticker}`);
            if (!response.ok) throw new Error('종목을 찾을 수 없습니다');
            
            const data = await response.json();
            const name = data.name || ticker;
            
            this.addCustomChartWithName(ticker, name);
            input.value = '';
            
            Notification.toast('차트 추가 완료', `${name} 차트가 추가되었습니다.`, 'success');
        } catch (error) {
            // API 호출 없이 바로 추가 (이름은 나중에 로드)
            this.addCustomChartWithName(ticker, ticker);
            input.value = '';
            Notification.toast('차트 추가 완료', `${ticker} 차트가 추가되었습니다.`, 'success');
        }
    },
    
    addCustomChartWithName(ticker, name) {
        // 중복 체크
        if (this.customTickers.some(t => t.ticker === ticker)) {
            Notification.toast('중복 오류', '이미 추가된 종목입니다.', 'error');
            return;
        }
        
        this.customTickers.push({
            ticker: ticker,
            name: name,
            addedAt: new Date().toISOString()
        });
        
        this.saveCustomCharts();
        this.renderChart(ticker, name);
        
        // WebSocket 구독
        WebSocketManager.subscribe(ticker);
    },
    
    removeCustomChart(ticker) {
        this.customTickers = this.customTickers.filter(t => t.ticker !== ticker);
        this.saveCustomCharts();
        
        // 차트 인스턴스 정리
        if (this.charts[ticker]) {
            this.charts[ticker].dispose();
            delete this.charts[ticker];
        }
        
        // DOM에서 제거
        const chartCard = document.getElementById(`custom-chart-card-${ticker.replace(/\./g, '_')}`);
        if (chartCard) {
            chartCard.remove();
        }
        
        // WebSocket 구독 취소
        WebSocketManager.unsubscribe(ticker);
        
        this.updateUI();
        Notification.toast('차트 삭제 완료', '차트가 삭제되었습니다.', 'success');
    },
    
    updateUI() {
        const listContainer = document.getElementById('customChartsList');
        const emptyState = document.getElementById('emptyCustomCharts');
        
        if (!listContainer) return;
        
        if (this.customTickers.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state" id="emptyCustomCharts">
                    <i class="fas fa-chart-bar"></i>
                    <p>추가된 차트가 없습니다.<br>위에서 종목을 추가해 보세요!</p>
                </div>
            `;
        }
    },
    
    async renderAllCharts() {
        for (const item of this.customTickers) {
            await this.renderChart(item.ticker, item.name);
        }
    },
    
    async renderChart(ticker, name) {
        const listContainer = document.getElementById('customChartsList');
        if (!listContainer) return;
        
        // 빈 상태 제거
        const emptyState = document.getElementById('emptyCustomCharts');
        if (emptyState) emptyState.remove();
        
        const cardId = `custom-chart-card-${ticker.replace(/\./g, '_')}`;
        const chartId = `custom-chart-${ticker.replace(/\./g, '_')}`;
        
        // 이미 존재하면 업데이트만
        if (document.getElementById(cardId)) {
            this.updateChartData(ticker);
            return;
        }
        
        // 카드 생성
        const card = document.createElement('div');
        card.id = cardId;
        card.className = 'custom-chart-card';
        card.innerHTML = `
            <div class="custom-chart-header">
                <div class="chart-title">
                    <h4>${name}</h4>
                    <span class="ticker-badge">${ticker}</span>
                </div>
                <button class="btn-icon btn-remove" onclick="CustomChartsManager.removeCustomChart('${ticker}')" title="차트 삭제">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="custom-chart-container" id="${chartId}"></div>
            <div class="custom-chart-loading">
                <i class="fas fa-spinner fa-spin"></i> 로딩 중...
            </div>
        `;
        
        listContainer.appendChild(card);
        
        // 데이터 로드 및 차트 렌더링
        await this.loadAndRenderChart(ticker, chartId);
    },
    
    async loadAndRenderChart(ticker, chartId) {
        try {
            const response = await fetch(`/api/stock/${ticker}`);
            if (!response.ok) throw new Error('데이터 로드 실패');
            
            const data = await response.json();
            
            // 로딩 표시 제거
            const card = document.getElementById(`custom-chart-card-${ticker.replace(/\./g, '_')}`);
            const loading = card?.querySelector('.custom-chart-loading');
            if (loading) loading.style.display = 'none';
            
            // 차트 렌더링
            this.renderEChart(chartId, data, data.name || ticker);
            
            // 이름 업데이트
            const titleEl = card?.querySelector('h4');
            if (titleEl && data.name) titleEl.textContent = data.name;
            
        } catch (error) {
            console.error(`차트 로드 오류 (${ticker}):`, error);
            const card = document.getElementById(`custom-chart-card-${ticker.replace(/\./g, '_')}`);
            const loading = card?.querySelector('.custom-chart-loading');
            if (loading) {
                loading.innerHTML = '<i class="fas fa-exclamation-triangle"></i> 데이터 로드 실패';
                loading.className = 'custom-chart-loading error';
            }
        }
    },
    
    renderEChart(containerId, data, name) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        // 기존 차트 정리
        if (this.charts[containerId]) {
            this.charts[containerId].dispose();
        }
        
        const chart = echarts.init(container);
        this.charts[data.ticker || containerId] = chart;
        
        const dates = data.dates || [];
        const prices = data.prices || [];
        const ma20 = data.ma20 || [];
        const ma60 = data.ma60 || [];
        const volumes = data.volumes || [];
        
        const option = {
            backgroundColor: 'transparent',
            title: {
                show: false
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: {
                    type: 'cross',
                    label: {
                        backgroundColor: '#6a7985'
                    }
                },
                backgroundColor: 'rgba(30, 41, 59, 0.95)',
                borderColor: '#475569',
                textStyle: {
                    color: '#e2e8f0',
                    fontSize: 12
                },
                formatter: function(params) {
                    let html = `<div style="font-weight:600;margin-bottom:5px;">${params[0].axisValue}</div>`;
                    params.forEach(p => {
                        const color = p.color;
                        html += `<div style="display:flex;align-items:center;margin:3px 0;">
                            <span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:50%;margin-right:8px;"></span>
                            <span style="flex:1;">${p.seriesName}:</span>
                            <span style="font-weight:600;margin-left:10px;">`;
                        if (typeof p.value === 'number') {
                            html += p.value.toLocaleString();
                        } else {
                            html += p.value;
                        }
                        html += '</span></div>';
                    });
                    return html;
                }
            },
            legend: {
                data: ['종가', 'MA20', 'MA60'],
                top: 0,
                textStyle: {
                    fontSize: 11,
                    color: document.body.classList.contains('dark-mode') ? '#94a3b8' : '#64748b'
                }
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '15%',
                top: '15%',
                containLabel: true
            },
            xAxis: {
                type: 'category',
                data: dates,
                axisLine: {
                    lineStyle: {
                        color: document.body.classList.contains('dark-mode') ? '#475569' : '#cbd5e1'
                    }
                },
                axisLabel: {
                    color: document.body.classList.contains('dark-mode') ? '#94a3b8' : '#64748b',
                    fontSize: 10,
                    formatter: function(value) {
                        const date = new Date(value);
                        return `${date.getMonth() + 1}/${date.getDate()}`;
                    }
                }
            },
            yAxis: [
                {
                    type: 'value',
                    position: 'left',
                    axisLine: {
                        lineStyle: {
                            color: document.body.classList.contains('dark-mode') ? '#475569' : '#cbd5e1'
                        }
                    },
                    axisLabel: {
                        color: document.body.classList.contains('dark-mode') ? '#94a3b8' : '#64748b',
                        fontSize: 10,
                        formatter: function(value) {
                            if (value >= 1000000) {
                                return (value / 1000000).toFixed(1) + 'M';
                            } else if (value >= 1000) {
                                return (value / 1000).toFixed(0) + 'K';
                            }
                            return value;
                        }
                    },
                    splitLine: {
                        lineStyle: {
                            color: document.body.classList.contains('dark-mode') ? 'rgba(71, 85, 105, 0.5)' : '#f1f5f9'
                        }
                    }
                },
                {
                    type: 'value',
                    position: 'right',
                    axisLine: { show: false },
                    axisLabel: { show: false },
                    splitLine: { show: false }
                }
            ],
            dataZoom: [
                {
                    type: 'inside',
                    start: 70,
                    end: 100
                }
            ],
            series: [
                {
                    name: '종가',
                    type: 'line',
                    data: prices,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: {
                        width: 2,
                        color: '#3b82f6'
                    },
                    itemStyle: {
                        color: '#3b82f6'
                    },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(59, 130, 246, 0.3)' },
                            { offset: 1, color: 'rgba(59, 130, 246, 0.05)' }
                        ])
                    }
                },
                {
                    name: 'MA20',
                    type: 'line',
                    data: ma20,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: {
                        width: 1.5,
                        color: '#f59e0b'
                    },
                    itemStyle: {
                        color: '#f59e0b'
                    }
                },
                {
                    name: 'MA60',
                    type: 'line',
                    data: ma60,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: {
                        width: 1.5,
                        color: '#ec4899'
                    },
                    itemStyle: {
                        color: '#ec4899'
                    }
                }
            ]
        };
        
        chart.setOption(option);
        
        // 반응형
        window.addEventListener('resize', () => {
            chart.resize();
        });
    },
    
    updateChartData(ticker, data) {
        // WebSocket 실시간 업데이트용
        const chart = this.charts[ticker];
        if (!chart || !data) return;
        
        // 새 데이터 포인트 추가 로직 (필요시 구현)
        // 현재는 주기적 새로고침으로 대체
    },
    
    refreshAllCharts() {
        this.customTickers.forEach(item => {
            this.loadAndRenderChart(item.ticker, `custom-chart-${item.ticker.replace(/\./g, '_')}`);
        });
    }
};

// ========================================
// Custom Charts 이벤트 위임 (동적 요소)
// ========================================
document.addEventListener('click', function(e) {
    // 삭제 버튼 클릭
    if (e.target.closest('.custom-chart-header .btn-remove')) {
        const btn = e.target.closest('.btn-remove');
        const ticker = btn.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
        if (ticker) {
            CustomChartsManager.removeCustomChart(ticker);
        }
    }
});

// ========================================
// Custom Charts 초기화
// ========================================
const originalInitWithCustomCharts = App.init;
App.init = async function() {
    await originalInitWithCustomCharts.call(this);
    CustomChartsManager.init();
};

// ========================================
// 앱 초기화 시 WebSocket 연결 및 포트폴리오 로드
// ========================================
// 전역 함수 노출 (HTML에서 사용)
window.SearchManager = SearchManager;
window.StockCard = StockCard;
window.WebSocketManager = WebSocketManager;
window.PortfolioManager = PortfolioManager;
window.BacktestManager = BacktestManager;
window.CustomChartsManager = CustomChartsManager;
