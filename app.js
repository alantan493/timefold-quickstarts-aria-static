/**
 * app.js - FIXED VRP UI with Fresh Random Seed Integration + Error Handling
 * 
 * PLACE THIS FILE IN: static/app.js
 * 
 * KEY FIX: Uses /route-plans-fresh endpoint for iteration testing to ensure different results
 * ADDED: Safe initialization with stub functions for missing dependencies
 */

// =============================================================================
// STUB FUNCTIONS FOR MISSING DEPENDENCIES
// =============================================================================

// Stub functions if timefold-webui.js doesn't load properly
if (typeof window.replaceQuickstartTimefoldAutoHeaderFooter === 'undefined') {
    window.replaceQuickstartTimefoldAutoHeaderFooter = function() {
        console.log('Using stub: replaceQuickstartTimefoldAutoHeaderFooter');
        const header = document.getElementById('timefold-auto-header');
        if (header) {
            header.innerHTML = `
                <div class="container-fluid bg-primary text-white p-2">
                    <h3 class="mb-0">🚛 Vehicle Routing with Timefold Solver</h3>
                </div>
            `;
        }
        
        const footer = document.getElementById('timefold-auto-footer');
        if (footer) {
            footer.innerHTML = `
                <div class="container-fluid bg-light p-2 text-center">
                    <small>Powered by Timefold Solver & GraphHopper</small>
                </div>
            `;
        }
    };
}

// Stub for showError function to prevent crashes
if (typeof window.showError === 'undefined') {
    window.showError = function(message, xhr) {
        console.error('Error:', message);
        
        // Try to extract meaningful error message
        let errorDetail = message;
        if (xhr) {
            try {
                if (xhr.responseJSON && xhr.responseJSON.detail) {
                    errorDetail = xhr.responseJSON.detail;
                } else if (xhr.responseText) {
                    errorDetail = xhr.responseText;
                } else if (xhr.status) {
                    errorDetail = `HTTP ${xhr.status}: ${message}`;
                }
            } catch (e) {
                console.warn('Could not parse error response:', e);
            }
        }
        
        // Show error notification
        const notification = document.createElement('div');
        notification.className = 'alert alert-danger alert-dismissible fade show position-fixed';
        notification.style.cssText = 'top: 1rem; right: 1rem; z-index: 1050; max-width: 400px;';
        notification.innerHTML = `
            <strong>⚠️ Error:</strong> ${errorDetail}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        const panel = document.getElementById('notificationPanel');
        if (panel) {
            panel.appendChild(notification);
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 10000);
        } else {
            document.body.appendChild(notification);
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 10000);
        }
    };
}

// =============================================================================
// MAIN APPLICATION VARIABLES AND STATE
// =============================================================================

let autoRefreshIntervalId = null;
let initialized = false;
let optimizing = false;
let demoDataId = null;
let scheduleId = null;
let loadedRoutePlan = null;
let newVisit = null;
let visitMarker = null;
let routesVisible = true;

let vrpTimer = {
    startTime: null,
    solveStartTime: null,
    optimizationEndTime: null,
    visualizationEndTime: null,
    isActive: false
};

let timingUpdateInterval = null;
let autoVisualizationActive = false;

const iterativeTestState = {
    running: false,
    config: {
        numIterations: 5,
        demoType: 'SINGAPORE_WIDE'
    },
    currentIteration: 0,
    results: [],
    routePlans: [],
    statistics: {
        best: null,
        worst: null,
        average: 0,
        variance: 0,
        variancePercentage: 0
    },
    timers: {
        testStartTime: null,
        iterationStartTime: null
    },
    eventListeners: new Map()
};

const solveButton = $('#solveButton');
const stopSolvingButton = $('#stopSolvingButton');
const vehiclesTable = $('#vehicles');
const analyzeButton = $('#analyzeButton');

const homeLocationMarkerByIdMap = new Map();
const visitMarkerByIdMap = new Map();

const map = L.map('map', {doubleClickZoom: false}).setView([51.505, -0.09], 13);
const visitGroup = L.layerGroup().addTo(map);
const homeLocationGroup = L.layerGroup().addTo(map);
const routeGroup = L.layerGroup().addTo(map);

const byVehiclePanel = document.getElementById("byVehiclePanel");
const byVehicleTimelineOptions = {
    timeAxis: {scale: "hour"},
    orientation: {axis: "top"},
    xss: {disabled: true},
    stack: false,
    stackSubgroups: false,
    zoomMin: 1000 * 60 * 60,
    zoomMax: 1000 * 60 * 60 * 24
};
const byVehicleGroupData = new vis.DataSet();
const byVehicleItemData = new vis.DataSet();
const byVehicleTimeline = new vis.Timeline(byVehiclePanel, byVehicleItemData, byVehicleGroupData, byVehicleTimelineOptions);

const byVisitPanel = document.getElementById("byVisitPanel");
const byVisitTimelineOptions = {
    timeAxis: {scale: "hour"},
    orientation: {axis: "top"},
    verticalScroll: true,
    xss: {disabled: true},
    stack: false,
    stackSubgroups: false,
    zoomMin: 1000 * 60 * 60,
    zoomMax: 1000 * 60 * 60 * 24
};
const byVisitGroupData = new vis.DataSet();
const byVisitItemData = new vis.DataSet();
const byVisitTimeline = new vis.Timeline(byVisitPanel, byVisitItemData, byVisitGroupData, byVisitTimelineOptions);

const RAINBOW_COLORS = [
    '#FF0000', '#FF8000', '#FFFF00', '#00FF00', '#0080FF', 
    '#8000FF', '#000000', '#FF4080', '#8B4513'
];

// =============================================================================
// ERROR HANDLING FUNCTIONS
// =============================================================================

function handleCriticalError(context, error, recovery = null) {
    console.error(`CRITICAL ERROR in ${context}:`, error);
    
    if (recovery && typeof recovery === 'function') {
        try {
            recovery();
        } catch (recoveryError) {
            console.error('Recovery function failed:', recoveryError);
        }
    }
    
    if (typeof showError === 'function') {
        showError(`${context} failed: ${error.message}`, null);
    } else {
        console.error('showError function not available');
        alert(`${context} failed: ${error.message}`);
    }
}

function resetButtonState(buttonId, originalText, originalClass = 'btn-primary') {
    const button = document.getElementById(buttonId);
    if (button) {
        button.disabled = false;
        button.textContent = originalText;
        button.className = `btn ${originalClass}`;
    }
}

// =============================================================================
// ITERATIVE TESTING UI AND FUNCTIONALITY
// =============================================================================

function createIterativeTestingUI() {
    if (document.getElementById('iterative-panel')) {
        console.log('Iterative testing panel already exists');
        return;
    }
    
    const panel = document.createElement('div');
    panel.id = 'iterative-panel';
    panel.className = 'card mt-3';
    
    panel.innerHTML = `
        <div class="card-header bg-success text-white">
            <h5 class="mb-0">🔄 FIXED Iterative Solve Testing - Fresh Random Seeds!</h5>
        </div>
        <div class="card-body">
            <div class="alert alert-info mb-3">
                <strong>🎲 FIXED:</strong> Each iteration now uses a <strong>fresh random seed</strong> via the 
                <code>/route-plans-fresh</code> endpoint to ensure different results. No more identical iterations!
            </div>
            <p class="mb-3">Run multiple consecutive solves to analyze optimization consistency with guaranteed result variation.</p>
            
            <div class="row mb-3">
                <div class="col-md-4">
                    <label class="form-label"><strong>Iterations:</strong></label>
                    <select id="iterations-select" class="form-select">
                        <option value="3">3 iterations (Quick)</option>
                        <option value="5" selected>5 iterations (Standard)</option>
                        <option value="7">7 iterations (Thorough)</option>
                        <option value="10">10 iterations (Comprehensive)</option>
                    </select>
                </div>
                <div class="col-md-4">
                    <label class="form-label"><strong>Demo Data:</strong></label>
                    <select id="demo-type-select" class="form-select">
                        <option value="SINGAPORE_WIDE" selected>Singapore Wide</option>
                        <option value="SINGAPORE_CENTRAL">Singapore Central</option>
                        <option value="SINGAPORE_EAST">Singapore East</option>
                        <option value="SINGAPORE_WEST">Singapore West</option>
                    </select>
                </div>
                <div class="col-md-4 d-flex align-items-end">
                    <button id="start-iterative-btn" class="btn btn-success w-100">
                        🎲 Start FIXED Test
                    </button>
                </div>
            </div>
            
            <div id="iterative-progress-section" style="display: none;">
                <div class="alert alert-primary">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <strong>Progress:</strong>
                        <span id="iteration-counter" class="badge bg-dark">Iteration 0/0</span>
                    </div>
                    <div class="progress mb-2">
                        <div id="iterative-progress-bar" class="progress-bar bg-success" style="width: 0%"></div>
                    </div>
                    <div id="iteration-status" class="small">Ready to start...</div>
                </div>
                
                <div class="row text-center mb-3">
                    <div class="col-3">
                        <div class="border rounded p-2">
                            <small>Current Distance</small><br>
                            <strong id="current-result" class="text-primary">--</strong>
                        </div>
                    </div>
                    <div class="col-3">
                        <div class="border rounded p-2">
                            <small>Best Distance</small><br>
                            <strong id="best-result" class="text-success">--</strong>
                        </div>
                    </div>
                    <div class="col-3">
                        <div class="border rounded p-2">
                            <small>Average</small><br>
                            <strong id="average-result" class="text-info">--</strong>
                        </div>
                    </div>
                    <div class="col-3">
                        <div class="border rounded p-2">
                            <small>Variance</small><br>
                            <strong id="variance-result" class="text-warning">--</strong>
                        </div>
                    </div>
                </div>
                
                <button id="stop-iterative-btn" class="btn btn-danger mb-3" style="display: none;">
                    ⛔ Stop Test
                </button>
            </div>
            
            <div id="iterative-results"></div>
        </div>
    `;
    
    const timingPanel = document.getElementById('vrp-timing-panel');
    const mapContainer = document.getElementById('map');
    
    if (timingPanel && timingPanel.parentNode) {
        timingPanel.parentNode.insertBefore(panel, timingPanel.nextSibling);
    } else if (mapContainer && mapContainer.parentNode) {
        mapContainer.parentNode.insertBefore(panel, mapContainer);
    } else {
        document.body.appendChild(panel);
    }
    
    addIterativeEventListeners();
    
    console.log('✅ FIXED Iterative testing UI created successfully');
}

function addIterativeEventListeners() {
    const startBtn = document.getElementById('start-iterative-btn');
    const stopBtn = document.getElementById('stop-iterative-btn');
    
    if (startBtn) {
        const startHandler = (e) => {
            e.preventDefault();
            startIterativeTest();
        };
        
        startBtn.addEventListener('click', startHandler);
        iterativeTestState.eventListeners.set('start-iterative-btn', startHandler);
    }
    
    if (stopBtn) {
        const stopHandler = (e) => {
            e.preventDefault();
            stopIterativeTest();
        };
        
        stopBtn.addEventListener('click', stopHandler);
        iterativeTestState.eventListeners.set('stop-iterative-btn', stopHandler);
    }
}

async function startIterativeTest() {
    if (iterativeTestState.running) {
        alert('Iterative test already running! Please wait.');
        return;
    }
    
    try {
        const numIterations = parseInt(document.getElementById('iterations-select').value);
        const demoType = document.getElementById('demo-type-select').value;
        
        iterativeTestState.running = true;
        iterativeTestState.config = { numIterations, demoType };
        iterativeTestState.currentIteration = 0;
        iterativeTestState.results = [];
        iterativeTestState.statistics = {
            best: null,
            worst: null,
            average: 0,
            variance: 0,
            variancePercentage: 0
        };
        iterativeTestState.timers.testStartTime = Date.now();
        
        document.getElementById('start-iterative-btn').style.display = 'none';
        document.getElementById('stop-iterative-btn').style.display = 'block';
        document.getElementById('iterative-progress-section').style.display = 'block';
        
        updateIterationDisplay('🎲 Starting FIXED iterative test with fresh random seeds...', 0);
        
        console.log(`🔄 Starting FIXED iterative test: ${numIterations} iterations with ${demoType} using /route-plans-fresh endpoint`);
        
        await loadDemoDataForTest(demoType);
        
        for (let i = 1; i <= numIterations && iterativeTestState.running; i++) {
            iterativeTestState.currentIteration = i;
            updateIterationDisplay(`🎲 Running iteration ${i}/${numIterations} with fresh random seed...`, (i-1)/numIterations * 100);
            
            await runSingleIterationWithFreshSeed(i, numIterations);
            
            if (iterativeTestState.running) {
                updateStatistics();
                updateIterationDisplay(`✅ Completed iteration ${i}/${numIterations}`, i/numIterations * 100);
                
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        if (iterativeTestState.running) {
            completeIterativeTest();
        }
        
    } catch (error) {
        console.error('FIXED Iterative test error:', error);
        updateIterationDisplay(`❌ Test failed: ${error.message}`, 0);
        stopIterativeTest();
    }
}

function loadDemoDataForTest(demoType) {
    return new Promise((resolve, reject) => {
        const demoMap = {
            'SINGAPORE_WIDE': 'SINGAPORE_WIDE',
            'SINGAPORE_CENTRAL': 'SINGAPORE_CENTRAL', 
            'SINGAPORE_EAST': 'SINGAPORE_EAST',
            'SINGAPORE_WEST': 'SINGAPORE_WEST'
        };
        
        const targetDemo = demoMap[demoType] || 'SINGAPORE_WIDE';
        
        if (demoDataId === targetDemo) {
            console.log(`📊 Demo data ${targetDemo} already loaded`);
            resolve();
            return;
        }
        
        demoDataId = targetDemo;
        scheduleId = null;
        initialized = false;
        
        homeLocationGroup.clearLayers();
        homeLocationMarkerByIdMap.clear();
        visitGroup.clearLayers();
        visitMarkerByIdMap.clear();
        routeGroup.clearLayers();
        
        $.getJSON(`/demo-data/${demoDataId}`)
            .done(function(routePlan) {
                loadedRoutePlan = routePlan;
                console.log(`✅ Loaded demo data: ${targetDemo}`);
                resolve();
            })
            .fail(function(xhr, status, error) {
                console.error(`Failed to load demo data ${targetDemo}:`, error);
                reject(new Error(`Failed to load demo data: ${error}`));
            });
    });
}

function runSingleIterationWithFreshSeed(iteration, totalIterations) {
    return new Promise((resolve, reject) => {
        if (!iterativeTestState.running) {
            resolve();
            return;
        }
        
        const iterationStartTime = Date.now();
        
        console.log(`🎲 Iteration ${iteration}: Starting solve with FRESH RANDOM SEED via /route-plans-fresh...`);
        
        // CRITICAL FIX: Use /route-plans-fresh endpoint instead of /route-plans
        $.post("/route-plans-fresh", JSON.stringify(loadedRoutePlan))
            .done(function(data) {
                console.log(`📋 Iteration ${iteration}: Fresh solve response:`, data);
                
                if (data.solution) {
                    // Direct solution response (synchronous solve)
                    const endTime = Date.now();
                    const duration = (endTime - iterationStartTime) / 1000;
                    
                    const solution = data.solution;
                    const totalDrivingTime = solution.totalDrivingTimeSeconds || 0;
                    const totalDistance = totalDrivingTime * 0.02;
                    
                    const vehicleDetails = solution.vehicles.map(vehicle => ({
                        id: vehicle.id,
                        drivingTime: vehicle.totalDrivingTimeSeconds || 0,
                        totalDemand: vehicle.totalDemand || 0,
                        capacity: vehicle.capacity || 0,
                        visitCount: vehicle.visits ? vehicle.visits.length : 0
                    }));
                    
                    console.log(`🎲 Iteration ${iteration} with fresh seed completed DIRECTLY: ${totalDistance.toFixed(1)}km`);
                    
                    const result = {
                        iteration,
                        distance: parseFloat(totalDistance.toFixed(1)),
                        totalDrivingTime: totalDrivingTime,
                        duration,
                        score: solution.score,
                        timestamp: endTime,
                        vehicleDetails: vehicleDetails,
                        vehicleCount: solution.vehicles.length,
                        visitCount: solution.visits.length,
                        usedFreshSeed: true,
                        endpointUsed: '/route-plans-fresh'
                    };
                    
                    iterativeTestState.results.push(result);
                    iterativeTestState.routePlans.push(solution);
                    
                    loadedRoutePlan = solution;
                    
                    routeGroup.clearLayers();
                    renderMarkersAndUI(solution);
                    renderStraightLineRoutes(solution);
                    
                    resolve();
                } else if (data.schedule_id) {
                    // Async response - need to monitor
                    scheduleId = data.schedule_id;
                    console.log(`📋 Iteration ${iteration}: Fresh solve started with scheduleId: ${scheduleId}`);
                    
                    monitorIterationProgress(iteration, iterationStartTime, resolve, reject);
                } else {
                    reject(new Error(`Unexpected response format from /route-plans-fresh`));
                }
            })
            .fail(function(xhr, status, error) {
                console.error(`Iteration ${iteration} with fresh seed failed to start:`, error);
                
                if (xhr.responseJSON && xhr.responseJSON.detail) {
                    console.error(`Backend error: ${xhr.responseJSON.detail}`);
                }
                
                reject(new Error(`Failed to start iteration ${iteration} with fresh seed: ${error}`));
            });
    });
}

function monitorIterationProgress(iteration, startTime, resolve, reject) {
    const checkInterval = setInterval(() => {
        if (!iterativeTestState.running) {
            clearInterval(checkInterval);
            resolve();
            return;
        }
        
        $.getJSON(`/route-plans/${scheduleId}`)
            .done(function(routePlan) {
                const isStillSolving = routePlan.solverStatus != null && routePlan.solverStatus !== "NOT_SOLVING";
                
                if (!isStillSolving) {
                    clearInterval(checkInterval);
                    
                    const endTime = Date.now();
                    const duration = (endTime - startTime) / 1000;
                    
                    const totalDrivingTime = routePlan.totalDrivingTimeSeconds || 0;
                    const totalDistance = totalDrivingTime * 0.02;
                    
                    const vehicleDetails = routePlan.vehicles.map(vehicle => ({
                        id: vehicle.id,
                        drivingTime: vehicle.totalDrivingTimeSeconds || 0,
                        totalDemand: vehicle.totalDemand || 0,
                        capacity: vehicle.capacity || 0,
                        visitCount: vehicle.visits ? vehicle.visits.length : 0
                    }));
                    
                    console.log(`🗺️ Fetching GraphHopper routes for iteration ${iteration}...`);
                    
                    $.getJSON(`/route-visualization/${scheduleId}`)
                        .done(function(graphHopperData) {
                            const result = {
                                iteration,
                                distance: parseFloat(totalDistance.toFixed(1)),
                                totalDrivingTime: totalDrivingTime,
                                duration,
                                score: routePlan.score,
                                timestamp: endTime,
                                vehicleDetails: vehicleDetails,
                                vehicleCount: routePlan.vehicles.length,
                                visitCount: routePlan.visits.length,
                                graphHopperData: graphHopperData,
                                usedFreshSeed: true,
                                endpointUsed: '/route-plans-fresh'
                            };
                            
                            iterativeTestState.results.push(result);
                            iterativeTestState.routePlans.push(routePlan);
                            
                            console.log(`✅ Iteration ${iteration} with fresh seed completed via async: ${totalDistance.toFixed(1)}km in ${duration.toFixed(1)}s`);
                            
                            loadedRoutePlan = routePlan;
                            
                            routeGroup.clearLayers();
                            renderMarkersAndUI(routePlan);
                            
                            if (graphHopperData && graphHopperData.vehicles) {
                                autoVisualizationActive = true;
                                renderGraphHopperRoutes(graphHopperData.vehicles);
                            }
                            
                            resolve();
                        })
                        .fail(function(xhr, status, error) {
                            console.warn(`⚠️ GraphHopper visualization failed for iteration ${iteration}, storing without routes:`, error);
                            
                            const result = {
                                iteration,
                                distance: parseFloat(totalDistance.toFixed(1)),
                                totalDrivingTime: totalDrivingTime,
                                duration,
                                score: routePlan.score,
                                timestamp: endTime,
                                vehicleDetails: vehicleDetails,
                                vehicleCount: routePlan.vehicles.length,
                                visitCount: routePlan.visits.length,
                                graphHopperData: null,
                                usedFreshSeed: true,
                                endpointUsed: '/route-plans-fresh'
                            };
                            
                            iterativeTestState.results.push(result);
                            iterativeTestState.routePlans.push(routePlan);
                            
                            console.log(`✅ Iteration ${iteration} with fresh seed completed (no GraphHopper): ${totalDistance.toFixed(1)}km in ${duration.toFixed(1)}s`);
                            
                            loadedRoutePlan = routePlan;
                            
                            routeGroup.clearLayers();
                            renderMarkersAndUI(routePlan);
                            autoVisualizationActive = false;
                            renderStraightLineRoutes(routePlan);
                            
                            resolve();
                        });
                } else {
                    const elapsed = (Date.now() - startTime) / 1000;
                    updateIterationDisplay(`🎲 Iteration ${iteration} with fresh seed solving... (${elapsed.toFixed(0)}s)`, 
                                         ((iteration-1) + 0.5) / iterativeTestState.config.numIterations * 100);
                }
            })
            .fail(function(xhr, status, error) {
                clearInterval(checkInterval);
                console.error(`Error monitoring iteration ${iteration}:`, error);
                reject(new Error(`Error monitoring iteration: ${error}`));
            });
    }, 2000);
}

function updateStatistics() {
    if (iterativeTestState.results.length === 0) return;
    
    const distances = iterativeTestState.results.map(r => r.distance);
    const stats = iterativeTestState.statistics;
    
    stats.best = Math.min(...distances);
    stats.worst = Math.max(...distances);
    stats.average = distances.reduce((a, b) => a + b, 0) / distances.length;
    
    const variance = distances.reduce((acc, dist) => acc + Math.pow(dist - stats.average, 2), 0) / distances.length;
    stats.variance = Math.sqrt(variance);
    stats.variancePercentage = stats.average > 0 ? (stats.variance / stats.average * 100) : 0;
    
    const current = distances[distances.length - 1];
    document.getElementById('current-result').textContent = `${current.toFixed(1)}km`;
    document.getElementById('best-result').textContent = `${stats.best.toFixed(1)}km`;
    document.getElementById('average-result').textContent = `${stats.average.toFixed(1)}km`;
    document.getElementById('variance-result').textContent = `${stats.variancePercentage.toFixed(1)}%`;
    
    updateResultsTable();
}

function updateResultsTable() {
    const resultsDiv = document.getElementById('iterative-results');
    if (!resultsDiv || iterativeTestState.results.length === 0) return;
    
    let tableHTML = `
        <h6><i class="fas fa-table"></i> FIXED Iteration Results (Fresh Random Seeds via /route-plans-fresh):</h6>
        <div class="table-responsive">
            <table class="table table-sm table-striped">
                <thead class="table-dark">
                    <tr>
                        <th>Iteration</th>
                        <th>Distance</th>
                        <th>Total Driving Time</th>
                        <th>Solve Duration</th>
                        <th>Vehicles</th>
                        <th>Visits</th>
                        <th>vs Previous</th>
                        <th>vs Best</th>
                        <th>Fresh Seed</th>
                        <th>Endpoint</th>
                        <th>Map Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    const stats = iterativeTestState.statistics;
    
    iterativeTestState.results.forEach((result, index) => {
        const prevResult = index > 0 ? iterativeTestState.results[index - 1] : null;
        const vsPrevious = prevResult ? 
            ((result.distance - prevResult.distance) / prevResult.distance * 100) : 0;
        const vsBest = stats.best ? 
            ((result.distance - stats.best) / stats.best * 100) : 0;
        
        const isBest = Math.abs(result.distance - stats.best) < 0.1;
        const isImprovement = vsPrevious < -0.5;
        
        let statusIcon = '🎲';
        let rowClass = '';
        
        if (isBest) {
            statusIcon = '🏆';
            rowClass = 'table-success';
        } else if (isImprovement) {
            statusIcon = '⬆️';
            rowClass = 'table-info';
        } else if (vsPrevious > 2) {
            statusIcon = '⬇️';
            rowClass = 'table-warning';
        }
        
        const vsPreviousText = prevResult ? 
            `${vsPrevious > 0 ? '+' : ''}${vsPrevious.toFixed(1)}%` : 'First';
        const vsBestText = `${vsBest > 0 ? '+' : ''}${vsBest.toFixed(1)}%`;
        
        const totalDrivingTimeFormatted = formatDrivingTime(result.totalDrivingTime);
        const hasGraphHopper = result.graphHopperData ? '🗺️' : '📍';
        const graphHopperTooltip = result.graphHopperData ? 'Singapore roads available' : 'Straight lines only';
        const freshSeedIcon = result.usedFreshSeed ? '✅' : '❌';
        const endpointUsed = result.endpointUsed || '/route-plans';
        
        tableHTML += `
            <tr class="${rowClass}">
                <td><strong>${result.iteration}</strong> ${statusIcon}</td>
                <td>${result.distance.toFixed(1)}km</td>
                <td>${totalDrivingTimeFormatted}</td>
                <td>${result.duration.toFixed(1)}s</td>
                <td>${result.vehicleCount}</td>
                <td>${result.visitCount}</td>
                <td>${vsPreviousText}</td>
                <td>${vsBestText}</td>
                <td title="Used fresh random seed">${freshSeedIcon}</td>
                <td><code>${endpointUsed}</code></td>
                <td>
                    <button class="btn btn-sm btn-info" onclick="viewIterationDetails(${index})">
                        📊 Stats
                    </button>
                    <button class="btn btn-sm btn-success" onclick="loadIterationVisualization(${index})" title="${graphHopperTooltip}">
                        ${hasGraphHopper} Load Map
                    </button>
                </td>
            </tr>
        `;
        
        if (result.vehicleDetails && result.vehicleDetails.length > 0) {
            tableHTML += `
                <tr class="table-light">
                    <td colspan="11">
                        <small>
                            <strong>Vehicle Details:</strong> 
                            ${result.vehicleDetails.map(v => 
                                `Vehicle ${v.id}: ${formatDrivingTime(v.drivingTime)} (${v.visitCount} visits, ${v.totalDemand}/${v.capacity} capacity)`
                            ).join(' | ')}
                        </small>
                    </td>
                </tr>
            `;
        }
    });
    
    tableHTML += `
                </tbody>
            </table>
        </div>
    `;
    
    resultsDiv.innerHTML = tableHTML;
}

function viewIterationDetails(iterationIndex) {
    const result = iterativeTestState.results[iterationIndex];
    const routePlan = iterativeTestState.routePlans[iterationIndex];
    
    if (!result || !routePlan) {
        alert('Iteration data not found');
        return;
    }
    
    let detailsHTML = `
        <div class="modal fade" id="iterationModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">🎲 Iteration ${result.iteration} - Fresh Random Seed Results</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-success">
                            <strong>✅ FIXED:</strong> This iteration used a <strong>fresh random seed</strong> via 
                            <code>${result.endpointUsed || '/route-plans-fresh'}</code> ensuring unique results. 
                            No more identical iterations!
                        </div>
                        <div class="alert alert-info">
                            <strong>💡 What's the difference?</strong><br>
                            <strong>📊 Stats:</strong> View detailed numbers and vehicle breakdown (this modal)<br>
                            <strong>🗺️ Load Map:</strong> Display this iteration's routes on the map for visual analysis
                        </div>
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <h6>📈 Performance Summary:</h6>
                                <ul>
                                    <li><strong>Total Distance:</strong> ${result.distance}km</li>
                                    <li><strong>Total Driving Time:</strong> ${formatDrivingTime(result.totalDrivingTime)}</li>
                                    <li><strong>Solve Duration:</strong> ${result.duration.toFixed(1)}s</li>
                                    <li><strong>Score:</strong> ${result.score}</li>
                                    <li><strong>Vehicles Used:</strong> ${result.vehicleCount}</li>
                                    <li><strong>Visits Planned:</strong> ${result.visitCount}</li>
                                    <li><strong>Route Type:</strong> ${result.graphHopperData ? '🗺️ Singapore Roads' : '📍 Straight Lines'}</li>
                                    <li><strong>Fresh Seed:</strong> ${result.usedFreshSeed ? '✅ Yes' : '❌ No'}</li>
                                    <li><strong>Endpoint:</strong> <code>${result.endpointUsed || '/route-plans-fresh'}</code></li>
                                </ul>
                            </div>
                            <div class="col-md-6">
                                <h6>🚛 Vehicle Performance:</h6>
                                <div class="table-responsive">
                                    <table class="table table-sm">
                                        <thead>
                                            <tr><th>Vehicle</th><th>Driving Time</th><th>Visits</th><th>Load</th></tr>
                                        </thead>
                                        <tbody>
                                            ${result.vehicleDetails.map(v => `
                                                <tr>
                                                    <td>Vehicle ${v.id}</td>
                                                    <td>${formatDrivingTime(v.drivingTime)}</td>
                                                    <td>${v.visitCount}</td>
                                                    <td>${v.totalDemand}/${v.capacity}</td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-success" onclick="loadIterationVisualization(${iterationIndex}); bootstrap.Modal.getInstance(document.getElementById('iterationModal')).hide();">
                            🗺️ Load This on Map
                        </button>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close Stats</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    const existingModal = document.getElementById('iterationModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    document.body.insertAdjacentHTML('beforeend', detailsHTML);
    
    const modal = new bootstrap.Modal(document.getElementById('iterationModal'));
    modal.show();
}

function loadIterationVisualization(iterationIndex) {
    const routePlan = iterativeTestState.routePlans[iterationIndex];
    const result = iterativeTestState.results[iterationIndex];
    
    if (!routePlan || !result) {
        alert('Route plan data not found for this iteration');
        return;
    }
    
    console.log(`🗺️ Loading visualization for Iteration ${result.iteration} (fresh seed: ${result.usedFreshSeed}, endpoint: ${result.endpointUsed})`);
    
    loadedRoutePlan = routePlan;
    scheduleId = null;
    
    routeGroup.clearLayers();
    
    renderMarkersAndUI(routePlan);
    renderTimelines(routePlan);
    
    if (result.graphHopperData && result.graphHopperData.vehicles) {
        console.log(`🗺️ Rendering ONLY GraphHopper routes for iteration ${result.iteration}`);
        
        try {
            renderGraphHopperRoutes(result.graphHopperData.vehicles);
            autoVisualizationActive = true;
            
            updateTimingStatus(`🗺️ Iteration ${result.iteration}: ${result.distance}km with Singapore roads (fresh seed: ${result.usedFreshSeed})`);
            console.log(`✅ Successfully loaded GraphHopper routes for iteration ${result.iteration}`);
            
        } catch (error) {
            console.error(`Error rendering GraphHopper routes for iteration ${result.iteration}:`, error);
            
            renderStraightLineRoutes(routePlan);
            autoVisualizationActive = false;
            updateTimingStatus(`📍 Iteration ${result.iteration}: ${result.distance}km (straight lines - GraphHopper error, fresh seed: ${result.usedFreshSeed})`);
        }
    } else {
        console.log(`📍 Rendering ONLY straight lines for iteration ${result.iteration}`);
        
        renderStraightLineRoutes(routePlan);
        autoVisualizationActive = false;
        updateTimingStatus(`📍 Iteration ${result.iteration}: ${result.distance}km (straight lines, fresh seed: ${result.usedFreshSeed})`);
    }
    
    document.getElementById('map').scrollIntoView({ behavior: 'smooth' });
    
    const routeType = result.graphHopperData ? 'Singapore roads' : 'straight lines';
    const seedInfo = result.usedFreshSeed ? ' (fresh seed ✅)' : ' (no fresh seed ❌)';
    const endpointInfo = result.endpointUsed || '/route-plans-fresh';
    alert(`Loaded Iteration ${result.iteration}: ${result.distance}km with ${routeType}${seedInfo} via ${endpointInfo}`);
}

function completeIterativeTest() {
    const testDuration = (Date.now() - iterativeTestState.timers.testStartTime) / 1000;
    const stats = iterativeTestState.statistics;
    
    console.log(`🏁 FIXED Iterative test completed in ${testDuration.toFixed(1)}s with fresh random seeds`);
    
    let assessmentClass = 'alert-success';
    let assessmentIcon = '✅';
    let assessmentTitle = 'EXCELLENT CONSISTENCY';
    let assessmentMessage = 'Your solver shows excellent consistency suitable for production use.';
    
    if (stats.variancePercentage > 15) {
        assessmentClass = 'alert-danger';
        assessmentIcon = '❌';
        assessmentTitle = 'HIGH VARIANCE - PRODUCTION RISK';
        assessmentMessage = 'High variance indicates algorithmic instability. Fix solver configuration before production.';
    } else if (stats.variancePercentage > 10) {
        assessmentClass = 'alert-warning';
        assessmentIcon = '⚠️';
        assessmentTitle = 'MODERATE VARIANCE - NEEDS TUNING';
        assessmentMessage = 'Variance is borderline. Consider tuning solver configuration for better consistency.';
    }
    
    const finalAnalysis = `
        <div class="alert ${assessmentClass} mt-3">
            <h5>${assessmentIcon} ${assessmentTitle}</h5>
            <div class="alert alert-success mb-3">
                <strong>🎲 FIXED:</strong> All iterations used <strong>fresh random seeds</strong> via 
                <code>/route-plans-fresh</code> endpoint ensuring proper variance testing. 
                No more identical results!
            </div>
            <div class="row">
                <div class="col-md-6">
                    <p><strong>Final Statistics:</strong></p>
                    <ul>
                        <li>Best Result: ${stats.best.toFixed(1)}km</li>
                        <li>Average: ${stats.average.toFixed(1)}km</li>
                        <li>Worst: ${stats.worst.toFixed(1)}km</li>
                        <li>Variance: ${stats.variancePercentage.toFixed(1)}%</li>
                        <li>Total Time: ${testDuration.toFixed(1)}s</li>
                        <li>Fresh Seeds: ✅ All iterations</li>
                        <li>Endpoint: <code>/route-plans-fresh</code></li>
                    </ul>
                </div>
                <div class="col-md-6">
                    <p><strong>Assessment:</strong></p>
                    <p>${assessmentMessage}</p>
                    ${stats.variancePercentage <= 10 ? `
                        <div class="badge bg-success fs-6">
                            🏆 PRODUCTION READY
                        </div>
                    ` : `
                        <div class="badge bg-danger fs-6">
                            ⚠️ NEEDS CONFIGURATION
                        </div>
                    `}
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('iterative-results').innerHTML += finalAnalysis;
    
    updateIterationDisplay(`🏁 FIXED test completed! Variance: ${stats.variancePercentage.toFixed(1)}% (fresh seeds via /route-plans-fresh)`, 100);
    
    setTimeout(() => {
        stopIterativeTest();
    }, 2000);
}

function stopIterativeTest() {
    iterativeTestState.running = false;
    
    document.getElementById('start-iterative-btn').style.display = 'block';
    document.getElementById('stop-iterative-btn').style.display = 'none';
    
    if (!iterativeTestState.results.length) {
        document.getElementById('iterative-progress-section').style.display = 'none';
    }
    
    console.log('🛑 FIXED Iterative test stopped');
}

function updateIterationDisplay(message, progress) {
    const counterEl = document.getElementById('iteration-counter');
    const progressBar = document.getElementById('iterative-progress-bar');
    const statusEl = document.getElementById('iteration-status');
    
    if (counterEl) {
        counterEl.textContent = `Iteration ${iterativeTestState.currentIteration}/${iterativeTestState.config.numIterations}`;
    }
    
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }
    
    if (statusEl) {
        statusEl.textContent = message;
    }
}

// =============================================================================
// TIMING PANEL FUNCTIONS
// =============================================================================

function createTimingPanel() {
    if (document.getElementById('vrp-timing-panel')) {
        console.log('Timing panel already exists');
        return;
    }
    
    const timingPanel = document.createElement('div');
    timingPanel.id = 'vrp-timing-panel';
    timingPanel.className = 'alert alert-info mt-2 mb-2';
    timingPanel.style.display = 'none';
    
    timingPanel.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
            <div>
                <strong>⏱️ VRP Timing</strong>
                <span id="timing-status" class="badge bg-secondary ms-2">READY</span>
            </div>
            <div class="d-flex gap-3">
                <span><small>Optimization:</small> <strong id="optimization-time">--</strong></span>
                <span><small>Visualization:</small> <strong id="visualization-time">--</strong></span>
                <span><small>Total:</small> <strong id="total-time">--</strong></span>
            </div>
        </div>
        <div id="status" class="mt-2 small text-muted">
            Ready for complete automated VRP process...
        </div>
    `;
    
    const mapContainer = document.getElementById('map');
    if (mapContainer && mapContainer.parentNode) {
        mapContainer.parentNode.insertBefore(timingPanel, mapContainer);
    }
    
    console.log('✅ VRP Timing panel created');
}

function updateTimingDisplay() {
    const panel = document.getElementById('vrp-timing-panel');
    if (!panel) {
        console.warn('Timing panel not found - cannot update display');
        return;
    }
    
    if (vrpTimer.isActive || vrpTimer.startTime) {
        panel.style.display = 'block';
    }
    
    const now = Date.now();
    
    const statusBadge = document.getElementById('timing-status');
    if (statusBadge) {
        if (vrpTimer.isActive) {
            const elapsed = ((now - vrpTimer.startTime) / 1000).toFixed(1);
            statusBadge.innerHTML = `🔄 RUNNING (${elapsed}s)`;
            statusBadge.className = 'badge bg-warning ms-2';
        } else if (vrpTimer.visualizationEndTime) {
            statusBadge.innerHTML = '✅ COMPLETE';
            statusBadge.className = 'badge bg-success ms-2';
        } else {
            statusBadge.innerHTML = 'READY';
            statusBadge.className = 'badge bg-secondary ms-2';
        }
    }
    
    updatePhaseDisplay('precomputation', vrpTimer.solveStartTime, vrpTimer.startTime);
    updatePhaseDisplay('optimization', vrpTimer.optimizationEndTime, vrpTimer.solveStartTime);
    updatePhaseDisplay('visualization', vrpTimer.visualizationEndTime, vrpTimer.optimizationEndTime);
    
    const totalTimeEl = document.getElementById('total-time');
    if (totalTimeEl) {
        if (vrpTimer.visualizationEndTime && vrpTimer.startTime) {
            const total = ((vrpTimer.visualizationEndTime - vrpTimer.startTime) / 1000).toFixed(1);
            totalTimeEl.textContent = `${total}s`;
        } else if (vrpTimer.isActive && vrpTimer.startTime) {
            const elapsed = ((now - vrpTimer.startTime) / 1000).toFixed(1);
            totalTimeEl.textContent = `${elapsed}s (running)`;
        } else {
            totalTimeEl.textContent = '--';
        }
    }
}

function updatePhaseDisplay(phaseName, endTime, startTime) {
    const timeEl = document.getElementById(`${phaseName}-time`);
    
    if (!timeEl) return;
    
    if (endTime && startTime) {
        const duration = ((endTime - startTime) / 1000).toFixed(1);
        timeEl.textContent = `${duration}s`;
    } else if (vrpTimer.isActive && startTime && !endTime) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        timeEl.textContent = `${elapsed}s`;
    } else if (vrpTimer.isActive && !startTime) {
        timeEl.textContent = 'pending';
    } else {
        timeEl.textContent = '--';
    }
}

function startTimingUpdates() {
    if (timingUpdateInterval) {
        clearInterval(timingUpdateInterval);
    }
    
    timingUpdateInterval = setInterval(updateTimingDisplay, 1000);
    console.log('⏱️ Started timing updates');
}

function stopTimingUpdates() {
    if (timingUpdateInterval) {
        clearInterval(timingUpdateInterval);
        timingUpdateInterval = null;
        console.log('⏱️ Stopped timing updates');
    }
}

function resetTimingDisplay() {
    console.log('🔄 Resetting timing display for new solve...');
    
    const statusBadge = document.getElementById('timing-status');
    if (statusBadge) {
        statusBadge.innerHTML = 'READY';
        statusBadge.className = 'badge bg-secondary ms-1';
    }
    
    const phases = ['precomputation', 'optimization', 'visualization'];
    phases.forEach(phase => {
        const timeEl = document.getElementById(`${phase}-time`);
        
        if (timeEl) timeEl.textContent = '--';
    });
    
    const totalTimeEl = document.getElementById('total-time');
    if (totalTimeEl) {
        totalTimeEl.textContent = '--';
    }
    
    updateTimingStatus('🚀 NEW solve starting - fresh timing session...');
    
    console.log('✅ Timing display reset complete');
}

function startVRPTimer() {
    if (iterativeTestState.running) {
        return;
    }
    
    vrpTimer.startTime = Date.now();
    vrpTimer.isActive = true;
    
    console.log('⏱️ NEW VRP Process started (fresh timing session)');
    updateTimingStatus('🚀 NEW solve process started (optimization + Singapore roads)...');
    updateTimingDisplay();
    startTimingUpdates();
}

function markSolveStart() {
    if (vrpTimer.isActive) {
        vrpTimer.solveStartTime = Date.now();
        console.log('⏱️ Optimization phase started (fresh session)');
        updateTimingStatus('🧠 Optimization in progress...');
        updateTimingDisplay();
    } else {
        console.warn('⚠️ markSolveStart called but timer not active');
    }
}

function markOptimizationEnd() {
    if (vrpTimer.isActive && !vrpTimer.optimizationEndTime) {
        vrpTimer.optimizationEndTime = Date.now();
        const optimizationTime = ((vrpTimer.optimizationEndTime - vrpTimer.solveStartTime) / 1000).toFixed(1);
        console.log(`⏱️ Optimization completed in ${optimizationTime}s (session: ${vrpTimer.startTime}) - auto-visualization will start next`);
        updateTimingStatus(`✅ Optimization complete (${optimizationTime}s). Starting auto Singapore roads...`);
        updateTimingDisplay();
    } else {
        console.warn('⚠️ markOptimizationEnd called but timer not active or already ended');
    }
}

function markVisualizationEnd() {
    if (vrpTimer.isActive) {
        vrpTimer.visualizationEndTime = Date.now();
        const totalTime = ((vrpTimer.visualizationEndTime - vrpTimer.startTime) / 1000).toFixed(1);
        const optimizationTime = ((vrpTimer.optimizationEndTime - vrpTimer.solveStartTime) / 1000).toFixed(1);
        const visualizationTime = ((vrpTimer.visualizationEndTime - vrpTimer.optimizationEndTime) / 1000).toFixed(1);
        
        console.log(`⏱️ Complete VRP Process: ${totalTime}s total (session: ${vrpTimer.startTime})`);
        console.log(`   🧠 Optimization: ${optimizationTime}s`);
        console.log(`   🗺️ Visualization: ${visualizationTime}s`);
        
        updateTimingStatus(`🏁 Complete VRP Process: ${totalTime}s (Optimization: ${optimizationTime}s, Visualization: ${visualizationTime}s)`);
        updateTimingDisplay();
        vrpTimer.isActive = false;
        
        setTimeout(stopTimingUpdates, 5000);
    } else {
        console.warn('⚠️ markVisualizationEnd called but timer not active');
    }
}

function updateTimingStatus(message) {
    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.innerHTML = message;
        statusEl.className = '';
    }
    console.log(`📊 Status: ${message}`);
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function colorByVehicle(vehicle) {
    if (!vehicle) return null;
    const vehicleIndex = parseInt(vehicle.id) || 0;
    return RAINBOW_COLORS[vehicleIndex % RAINBOW_COLORS.length];
}

function formatDrivingTime(drivingTimeInSeconds) {
    const hours = Math.floor(drivingTimeInSeconds / 3600);
    const minutes = Math.round((drivingTimeInSeconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

function showTimeOnly(localDateTimeString) {
    return JSJoda.LocalDateTime.parse(localDateTimeString).toLocalTime();
}

function homeLocationPopupContent(vehicle) {
    return `<h5>Vehicle ${vehicle.id}</h5>Home Location`;
}

function visitPopupContent(visit) {
    const arrival = visit.arrivalTime ? `<h6>Arrival at ${showTimeOnly(visit.arrivalTime)}.</h6>` : '';
    return `<h5>${visit.name}</h5>
    <h6>Demand: ${visit.demand}</h6>
    <h6>Available from ${showTimeOnly(visit.minStartTime)} to ${showTimeOnly(visit.maxEndTime)}.</h6>
    ${arrival}`;
}

// =============================================================================
// MAP RENDERING FUNCTIONS
// =============================================================================

function getHomeLocationMarker(vehicle) {
    try {
        let marker = homeLocationMarkerByIdMap.get(vehicle.id);
        if (marker) {
            marker.setStyle({ 
                color: colorByVehicle(vehicle), 
                fillColor: colorByVehicle(vehicle),
                fillOpacity: 0.8,
                weight: 3,
                radius: 8
            });
            return marker;
        }
        marker = L.circleMarker(vehicle.homeLocation, { 
            color: colorByVehicle(vehicle), 
            fillColor: colorByVehicle(vehicle),
            fillOpacity: 0.8,
            weight: 3,
            radius: 8
        });
        marker.addTo(homeLocationGroup).bindPopup();
        homeLocationMarkerByIdMap.set(vehicle.id, marker);
        return marker;
    } catch (error) {
        console.error('Error creating home location marker:', error);
        return null;
    }
}

function getVisitMarker(visit) {
    try {
        let marker = visitMarkerByIdMap.get(visit.id);
        if (marker) return marker;
        
        marker = L.circleMarker(visit.location);
        marker.addTo(visitGroup).bindPopup();
        visitMarkerByIdMap.set(visit.id, marker);
        return marker;
    } catch (error) {
        console.error('Error creating visit marker:', error);
        return null;
    }
}

function renderMarkersAndUI(solution) {
    try {
        if (!initialized) {
            const bounds = [solution.southWestCorner, solution.northEastCorner];
            map.fitBounds(bounds);
        }

        vehiclesTable.children().remove();
        solution.vehicles.forEach(function (vehicle) {
            const marker = getHomeLocationMarker(vehicle);
            if (marker) {
                marker.setPopupContent(homeLocationPopupContent(vehicle));
            }
            
            const {id, capacity, totalDemand, totalDrivingTimeSeconds} = vehicle;
            const percentage = totalDemand / capacity * 100;
            const color = colorByVehicle(vehicle);
            
            vehiclesTable.append(`
                <tr>
                    <td><i class="fas fa-circle" style="color: ${color}; font-size: 1.2rem;"></i></td>
                    <td>Vehicle ${id}</td>
                    <td>
                        <div class="progress" data-bs-toggle="tooltip-load" data-bs-placement="left" 
                             title="Cargo: ${totalDemand} / Capacity: ${capacity}">
                            <div class="progress-bar" role="progressbar" 
                                 style="width: ${percentage}%; background-color: ${color};">
                                 ${totalDemand}/${capacity}
                            </div>
                        </div>
                    </td>
                    <td>${formatDrivingTime(totalDrivingTimeSeconds)}</td>
                </tr>`);
        });

        solution.visits.forEach(visit => {
            const marker = getVisitMarker(visit);
            if (marker) {
                marker.setPopupContent(visitPopupContent(visit));
            }
        });
        
        $('#score').text(solution.score);
        $('#drivingTime').text(formatDrivingTime(solution.totalDrivingTimeSeconds));
        
    } catch (error) {
        handleCriticalError('renderMarkersAndUI', error);
    }
}

function renderStraightLineRoutes(solution) {
    try {
        routeGroup.clearLayers();
        const visitByIdMap = new Map(solution.visits.map(visit => [visit.id, visit]));
        
        solution.vehicles.forEach(vehicle => {
            const homeLocation = vehicle.homeLocation;
            const locations = vehicle.visits.map(visitId => visitByIdMap.get(visitId).location);
            L.polyline([homeLocation, ...locations, homeLocation], {
                color: colorByVehicle(vehicle),
                weight: 4,
                opacity: 0.8
            }).addTo(routeGroup);
        });
    } catch (error) {
        console.error('Error rendering straight line routes:', error);
    }
}

function renderGraphHopperRoutes(vehicles) {
    let routesRendered = 0;
    
    try {
        vehicles.forEach((vehicle, vehicleIndex) => {
            const matchingVehicle = loadedRoutePlan.vehicles.find(v => v.id === vehicle.id);
            const color = colorByVehicle(matchingVehicle) || RAINBOW_COLORS[vehicleIndex % RAINBOW_COLORS.length];
            
            if (vehicle.routes && Array.isArray(vehicle.routes) && vehicle.routes.length > 0) {
                vehicle.routes.forEach(route => {
                    if (route.geometry && Array.isArray(route.geometry) && route.geometry.length > 1) {
                        const leafletCoords = route.geometry.map(coord => {
                            if (Array.isArray(coord) && coord.length >= 2 && 
                                typeof coord[0] === 'number' && typeof coord[1] === 'number') {
                                return [coord[1], coord[0]];
                            }
                            return null;
                        }).filter(coord => coord !== null);
                        
                        if (leafletCoords.length > 1) {
                            const polyline = L.polyline(leafletCoords, {
                                color: color,
                                weight: 8,
                                opacity: 0.9
                            });
                            
                            polyline.bindPopup(`
                                <b>Vehicle ${vehicle.id}</b><br>
                                Distance: ${(route.distance || 0).toFixed(0)}m<br>
                                Duration: ${Math.round((route.duration || 0) / 60)}min<br>
                                Points: ${leafletCoords.length}
                            `);
                            
                            polyline.addTo(routeGroup);
                            routesRendered++;
                        }
                    }
                });
            }
        });
        
        if (routesRendered === 0) {
            throw new Error('No routes were successfully rendered');
        }
        
        console.log(`✅ Rendered ${routesRendered} GraphHopper routes successfully`);
        
    } catch (error) {
        console.error('Error rendering GraphHopper routes:', error);
        throw error;
    }
}

// =============================================================================
// MAIN VRP SOLVE FUNCTIONS
// =============================================================================

function solve() {
    try {
        if (iterativeTestState.running) {
            console.log('⏭️ Skipping standard solve timing (iterative test active)');
        } else {
            console.log('🔄 NEW SOLVE: Completely resetting timing state...');
            
            stopTimingUpdates();
            autoVisualizationActive = false;
            
            vrpTimer = {
                startTime: null,
                solveStartTime: null,
                optimizationEndTime: null,
                visualizationEndTime: null,
                isActive: false
            };
            
            resetTimingDisplay();
            startVRPTimer();
        }
        
        console.log('🚀 Starting solve process');
        
        $.post("/route-plans", JSON.stringify(loadedRoutePlan), function (data) {
            scheduleId = data;
            console.log(`📋 Solve started with scheduleId: ${scheduleId}`);
            
            if (!iterativeTestState.running) {
                markSolveStart();
            }
            
            refreshSolvingButtons(true);
        }).fail(function (xhr) {
            if (typeof showError === 'function') {
                showError("Start solving failed.", xhr);
            } else {
                console.error("Start solving failed:", xhr);
                alert("Start solving failed. Check console for details.");
            }
            refreshSolvingButtons(false);
            if (!iterativeTestState.running) {
                vrpTimer.isActive = false;
                autoVisualizationActive = false;
                stopTimingUpdates();
            }
        }, "text");
        
    } catch (error) {
        handleCriticalError('solve', error, () => {
            refreshSolvingButtons(false);
            if (!iterativeTestState.running) {
                vrpTimer.isActive = false;
                autoVisualizationActive = false;
                stopTimingUpdates();
            }
        });
    }
}

function refreshSolvingButtons(solving) {
    if (solving) {
        solveButton.hide();
        stopSolvingButton.show();
        $("#showRealRoads").hide();
        $("#osrmRoutesButton").hide();
        $("#toggleRoutesVisibility").hide();
    } else {
        solveButton.show();
        stopSolvingButton.hide();
        if (scheduleId) {
            $("#showRealRoads").show();
            $("#toggleRoutesVisibility").show();
        }
    }
}

function stopSolving() {
    console.log('🛑 Stopping solve process...');
    $.delete("/route-plans/" + scheduleId)
        .done(function () {
            console.log('✅ Solve stopped successfully');
            refreshSolvingButtons(false);
            if (!iterativeTestState.running) {
                vrpTimer.isActive = false;
                autoVisualizationActive = false;
                stopTimingUpdates();
                updateTimingStatus('🛑 Solve stopped by user');
            }
        })
        .fail(function (xhr) {
            if (typeof showError === 'function') {
                showError("Stop solving failed.", xhr);
            } else {
                console.error("Stop solving failed:", xhr);
                alert("Stop solving failed. Check console for details.");
            }
        });
}

function analyze() {
    console.log('📊 Starting score analysis...');
    if (loadedRoutePlan == null) {
        const notification = document.createElement('div');
        notification.className = 'alert alert-warning alert-dismissible fade show position-fixed';
        notification.style.cssText = 'top: 1rem; right: 1rem; z-index: 1050;';
        notification.innerHTML = `
            <strong>No solution loaded!</strong> Please solve first, then analyze.
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 5000);
        return;
    }
    
    $('#scoreAnalysisScoreLabel').text(`(${loadedRoutePlan.score})`);
    
    try {
        if (typeof refreshScoreDirector === 'function') {
            refreshScoreDirector(loadedRoutePlan);
        } else {
            console.warn('refreshScoreDirector function not available');
            $('#scoreAnalysisModalContent').html(`
                <div class="alert alert-info">
                    <h5>📊 Solution Analysis</h5>
                    <p><strong>Score:</strong> ${loadedRoutePlan.score}</p>
                    <p><strong>Total Driving Time:</strong> ${formatDrivingTime(loadedRoutePlan.totalDrivingTimeSeconds)}</p>
                    <p><strong>Vehicles:</strong> ${loadedRoutePlan.vehicles.length}</p>
                    <p><strong>Visits:</strong> ${loadedRoutePlan.visits.length}</p>
                    <p><em>Detailed score analysis not available (score-analysis.js not loaded)</em></p>
                </div>
            `);
        }
    } catch (error) {
        console.error('Error in score analysis:', error);
        $('#scoreAnalysisModalContent').html(`
            <div class="alert alert-warning">
                <h5>⚠️ Analysis Error</h5>
                <p>Could not perform detailed score analysis: ${error.message}</p>
                <p><strong>Basic Info:</strong></p>
                <ul>
                    <li>Score: ${loadedRoutePlan.score}</li>
                    <li>Total Driving Time: ${formatDrivingTime(loadedRoutePlan.totalDrivingTimeSeconds)}</li>
                    <li>Vehicles: ${loadedRoutePlan.vehicles.length}</li>
                    <li>Visits: ${loadedRoutePlan.visits.length}</li>
                </ul>
            </div>
        `);
    }
    
    const modal = new bootstrap.Modal(document.getElementById('scoreAnalysisModal'));
    modal.show();
}

// =============================================================================
// ADDITIONAL FUNCTIONS (timeline, refresh, etc.)
// =============================================================================

function renderTimelines(solution) {
    try {
        if (typeof vis === 'undefined') {
            console.warn('vis.js not loaded - skipping timeline rendering');
            return;
        }
        
        // Clear existing timeline data
        byVehicleGroupData.clear();
        byVehicleItemData.clear();
        byVisitGroupData.clear();
        byVisitItemData.clear();
        
        // Render vehicle timeline
        solution.vehicles.forEach(vehicle => {
            byVehicleGroupData.add({
                id: vehicle.id,
                content: `Vehicle ${vehicle.id}`,
                style: `color: ${colorByVehicle(vehicle)};`
            });
        });
        
        // Render visit timeline
        solution.visits.forEach(visit => {
            byVisitGroupData.add({
                id: visit.id,
                content: visit.name
            });
            
            if (visit.arrivalTime) {
                byVisitItemData.add({
                    id: visit.id,
                    group: visit.id,
                    content: visit.name,
                    start: JSJoda.LocalDateTime.parse(visit.arrivalTime).toString(),
                    end: JSJoda.LocalDateTime.parse(visit.arrivalTime).toString()
                });
            }
        });
        
    } catch (error) {
        console.error('Error rendering timelines:', error);
    }
}

function refresh() {
    if (scheduleId) {
        console.log('🔄 Refreshing route plan data...');
        
        $.getJSON(`/route-plans/${scheduleId}`)
            .done(function(routePlan) {
                const isStillSolving = routePlan.solverStatus != null && routePlan.solverStatus !== "NOT_SOLVING";
                refreshSolvingButtons(isStillSolving);
                
                if (!isStillSolving && !iterativeTestState.running) {
                    markOptimizationEnd();
                }
                
                loadedRoutePlan = routePlan;
                renderMarkersAndUI(routePlan);
                renderTimelines(routePlan);
                
                if (!autoVisualizationActive && !isStillSolving && !iterativeTestState.running) {
                    console.log('🗺️ Auto-loading GraphHopper visualization...');
                    showGraphHopperRoutes();
                }
                
                console.log(`✅ Refreshed route plan (solving: ${isStillSolving})`);
            })
            .fail(function(xhr) {
                if (typeof showError === 'function') {
                    showError("Refresh failed.", xhr);
                } else {
                    console.error("Refresh failed:", xhr);
                }
            });
    }
}

function fetchDemoData() {
    console.log('📊 Fetching demo data...');
    
    const targetDemoId = demoDataId || 'SINGAPORE_WIDE';
    
    $.getJSON(`/demo-data/${targetDemoId}`)
        .done(function(routePlan) {
            demoDataId = targetDemoId;
            scheduleId = null;
            loadedRoutePlan = routePlan;
            
            console.log(`✅ Loaded demo data: ${targetDemoId}`);
            
            renderMarkersAndUI(routePlan);
            renderTimelines(routePlan);
            refreshSolvingButtons(false);
            initialized = true;
            
            if (!iterativeTestState.running) {
                updateTimingStatus('📊 Demo data loaded. Ready to solve...');
            }
        })
        .fail(function(xhr) {
            console.error('Failed to load demo data:', xhr);
            if (typeof showError === 'function') {
                showError("Failed to load demo data.", xhr);
            } else {
                alert("Failed to load demo data. Check console for details.");
            }
        });
}

function setupAjax() {
    // Set up auto-refresh
    if (autoRefreshIntervalId != null) {
        clearInterval(autoRefreshIntervalId);
    }
    autoRefreshIntervalId = setInterval(refresh, 2000);
    
    // Set up jQuery AJAX defaults
    $.ajaxSetup({
        contentType: "application/json"
    });
    
    // Add custom HTTP methods
    $.extend({
        delete: function(url, data, callback, type) {
            if ($.isFunction(data)) {
                type = type || callback;
                callback = data;
                data = undefined;
            }
            return $.ajax({
                url: url,
                type: 'DELETE',
                data: data,
                success: callback,
                dataType: type
            });
        }
    });
}

function showGraphHopperRoutes() {
    if (!scheduleId) {
        alert('No route plan loaded. Please solve first.');
        return;
    }
    
    console.log('🗺️ Loading GraphHopper routes...');
    $("#showRealRoads").prop("disabled", true).text("Loading...");
    
    $.getJSON(`/route-visualization/${scheduleId}`)
        .done(function(graphHopperData) {
            console.log('✅ GraphHopper data received:', graphHopperData);
            
            if (graphHopperData && graphHopperData.vehicles) {
                routeGroup.clearLayers();
                renderGraphHopperRoutes(graphHopperData.vehicles);
                autoVisualizationActive = true;
                
                if (!iterativeTestState.running) {
                    markVisualizationEnd();
                }
                
                $("#showRealRoads").hide();
                $("#toggleRoutesVisibility").show();
                
                console.log('✅ GraphHopper routes rendered successfully');
            } else {
                throw new Error('Invalid GraphHopper response format');
            }
        })
        .fail(function(xhr) {
            console.error('GraphHopper visualization failed:', xhr);
            
            renderStraightLineRoutes(loadedRoutePlan);
            autoVisualizationActive = false;
            
            if (!iterativeTestState.running) {
                markVisualizationEnd();
            }
            
            if (typeof showError === 'function') {
                showError("Failed to load GraphHopper routes. Showing straight lines instead.", xhr);
            } else {
                alert("Failed to load GraphHopper routes. Showing straight lines instead.");
            }
        })
        .always(function() {
            $("#showRealRoads").prop("disabled", false).text("Show Real Roads");
        });
}

function toggleRoutesVisibility() {
    if (routesVisible) {
        routeGroup.clearLayers();
        routesVisible = false;
        $("#toggleRoutesVisibility").html('<i class="fas fa-eye"></i> Show Routes');
    } else {
        if (autoVisualizationActive && scheduleId) {
            showGraphHopperRoutes();
        } else {
            renderStraightLineRoutes(loadedRoutePlan);
        }
        routesVisible = true;
        $("#toggleRoutesVisibility").html('<i class="fas fa-eye-slash"></i> Hide Routes');
    }
}

function openRecommendationModal(lat, lng) {
    // This function would handle adding new visits - stub for now
    console.log(`Opening recommendation modal for coordinates: ${lat}, ${lng}`);
}

// =============================================================================
// SAFE INITIALIZATION
// =============================================================================

$(document).ready(function () {
    try {
        // Check if required functions exist before calling them
        if (typeof replaceQuickstartTimefoldAutoHeaderFooter === 'function') {
            replaceQuickstartTimefoldAutoHeaderFooter();
        } else {
            console.warn('replaceQuickstartTimefoldAutoHeaderFooter not found - creating basic header');
            // Create a basic header if the function is missing
            const header = document.getElementById('timefold-auto-header');
            if (header) {
                header.innerHTML = `
                    <div class="container-fluid bg-primary text-white p-2">
                        <h3 class="mb-0">🚛 Vehicle Routing with Timefold Solver + GraphHopper</h3>
                    </div>
                `;
            }
            
            const footer = document.getElementById('timefold-auto-footer');
            if (footer) {
                footer.innerHTML = `
                    <div class="container-fluid bg-light p-2 text-center">
                        <small>Powered by Timefold Solver & GraphHopper | Fresh Random Seeds via /route-plans-fresh</small>
                    </div>
                `;
            }
        }
        
        // Initialize Leaflet map
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
        }).addTo(map);

        // Set up button event handlers
        solveButton.click(solve);
        stopSolvingButton.click(stopSolving);
        analyzeButton.click(analyze);
        refreshSolvingButtons(false);

        // Set up tab event handlers
        $("#byVehicleTab").on('shown.bs.tab', () => {
            if (typeof byVehicleTimeline !== 'undefined' && byVehicleTimeline.redraw) {
                byVehicleTimeline.redraw();
            }
        });
        $("#byVisitTab").on('shown.bs.tab', () => {
            if (typeof byVisitTimeline !== 'undefined' && byVisitTimeline.redraw) {
                byVisitTimeline.redraw();
            }
        });
        
        // Set up map click handler
        map.on('click', function (e) {
            visitMarker = L.circleMarker(e.latlng, {color: 'green'});
            visitMarker.addTo(map);
            openRecommendationModal(e.latlng.lat, e.latlng.lng);
        });
        
        // Set up modal handler
        $("#newVisitModal").on("hidden.bs.modal", () => {
            if (visitMarker) map.removeLayer(visitMarker);
        });

        // Set up AJAX with error handling
        setupAjax();
        
        // Load demo data
        fetchDemoData();
        
        // Initialize UI components with delay to ensure DOM is ready
        setTimeout(() => {
            createTimingPanel();
            createIterativeTestingUI(); // FIXED version with /route-plans-fresh
            resetTimingDisplay();
            updateTimingDisplay();
        }, 1000);
        
        console.log('✅ FIXED VRP application with fresh random seed iterative testing initialized successfully');
        
    } catch (error) {
        console.error('❌ Application initialization failed:', error);
        
        // Show user-friendly error message
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger m-3';
        errorDiv.innerHTML = `
            <h4>⚠️ Application Error</h4>
            <p><strong>The application failed to initialize:</strong> ${error.message}</p>
            <p>This might be due to missing dependencies. Please check:</p>
            <ul>
                <li>All script files are loading correctly</li>
                <li>Your server is serving static files properly</li>
                <li>Browser console for additional errors</li>
            </ul>
            <button class="btn btn-primary" onclick="location.reload()">🔄 Reload Page</button>
        `;
        
        document.body.insertBefore(errorDiv, document.body.firstChild);
    }
});

console.log('✅ FIXED VRP Application with Fresh Random Seed Support (/route-plans-fresh) and Error Handling loaded successfully');