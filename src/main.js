import * as THREE from 'three';
import { CoreModule } from './CoreModule.js';
import { PlaneModule } from './PlaneModule.js';
import { PathModule } from './PathModule.js';

// 创建模块实例
const coreModule = new CoreModule();
const planeModule = new PlaneModule(coreModule);
const pathModule = new PathModule(coreModule, planeModule);

// 设置模块间的回调函数
function setupModuleCallbacks() {
    // 核心模块回调
    coreModule.onModelLoaded = () => {
        planeModule.enablePlaneUI();
        planeModule.enterPlaneMode();
    };
    
    coreModule.onUndo = () => pathModule.undo();
    
    // 平面模块回调
    planeModule.onPlaneConfirmed = () => {
        // 启用路径设计UI
        disableDesignUI(false);
        // 路径曲线会在路径模块中自动管理
        planeModule.togglePlaneVisibilityBtn.disabled = false;
        coreModule.setStatus('请选择操作模式。');
    };
    
    planeModule.onContactPointsCalculated = () => {
        // 如果当前是AI模式，更新AI模式按钮状态
        if (pathModule.getIsAIGenerationMode()) {
            updateAIModeButtons();
        }
    };
    
    // 路径模块回调
    pathModule.onPathUpdated = () => {
        // 路径更新时的处理
    };
    
    pathModule.onExportAvailabilityChanged = () => {
        // 导出可用性变化时的处理
    };
}

// UI控制函数
function disableDesignUI(disabled) {
    const designModeSelect = document.getElementById('design-mode');
    const toggleDrawBtn = document.getElementById('toggle-draw');
    const toggleEditBtn = document.getElementById('toggle-edit');
    const clearAllBtn = document.getElementById('clear-all');
    const generateUloopBtn = document.getElementById('generate-uloop');
    const undoBtn = document.getElementById('undo');
    
    designModeSelect.disabled = disabled;
    toggleDrawBtn.disabled = disabled;
    toggleEditBtn.disabled = disabled;
    clearAllBtn.disabled = disabled;
    generateUloopBtn.disabled = true;
    undoBtn.disabled = pathModule.historyStack.length === 0;
}

function updateAIModeButtons() {
    const geminiApiKeyInput = document.getElementById('gemini-api-key');
    const generateAiPathBtn = document.getElementById('generate-ai-path');
    const exportContactPointsBtn = document.getElementById('export-contact-points');
    const exportAiResponseBtn = document.getElementById('export-ai-response');
    
    const hasApiKey = geminiApiKeyInput.value.trim().length > 0;
    const hasContactPoints = planeModule.getContactPoints().length > 0;
    const hasAIResponse = pathModule.lastAIResponse !== null;
    
    generateAiPathBtn.disabled = !hasApiKey || !hasContactPoints;
    exportContactPointsBtn.disabled = !hasContactPoints;
    exportAiResponseBtn.disabled = !hasAIResponse;
}

// 事件处理函数
function handleCanvasMouseDown(event) {
    if (event.button !== 0) return;
    
    // 编辑模式下的U-loop选择
    if (pathModule.getIsEditMode() && event.shiftKey) {
        const raycaster = coreModule.getRaycaster();
        const mouse = coreModule.getMouse();
        const camera = coreModule.getCamera();
        
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(pathModule.draggableObjects);
        if (intersects.length > 0) {
            pathModule.handleULoopSelection(intersects[0].object);
        } else {
            pathModule.deselectAllPoints();
        }
        event.stopImmediatePropagation();
        return;
    }
}

function handleCanvasMouseUp(event) {
    if (event.button !== 0) return;
    if (coreModule.getIsDraggingView()) return;
    if (!coreModule.getModelMesh()) return;
    
    // 平面模式处理
    if (planeModule.getIsPlaneMode() && planeModule.planeControlPoints.length < 3) {
        planeModule.handlePlaneModeClick();
        return;
    }
    
    // 绘制模式处理
    if (pathModule.getIsDrawingMode()) {
        pathModule.addPointAtCursor();
    }
    
    // 接触点模式处理
    if (pathModule.getIsContactPointsMode()) {
        planeModule.handleContactPointSelection();
        // 如果选择了两个接触点，生成路径
        if (planeModule.getSelectedContactPoints().length === 2) {
            pathModule.generatePathFromContactPoints();
        }
    }
    
    // 抛物线模式处理
    if (pathModule.getIsParabolaMode()) {
        pathModule.handleParabolaMouseUp();
    }
}

// AI生成相关函数
async function generateAIPath() {
    const geminiApiKeyInput = document.getElementById('gemini-api-key');
    const aiPromptInput = document.getElementById('ai-prompt');
    const aiStatusEl = document.getElementById('ai-status');
    
    const apiKey = geminiApiKeyInput.value.trim();
    if (!apiKey) {
        setAIStatus('请输入Gemini API密钥', true);
        return;
    }
    
    const contactPoints = planeModule.getContactPoints();
    if (contactPoints.length === 0) {
        setAIStatus('没有接触点数据，请先确认参考平面', true);
        return;
    }
    
    // 准备接触点数据
    const contactPointsData = {
        contactPoints: contactPoints.map(point => ({
            x: point.x,
            y: point.y,
            z: point.z
        })),
        totalPoints: contactPoints.length
    };
    
    // 获取用户自定义prompt或使用默认prompt
    const customPrompt = aiPromptInput.value.trim();
    const defaultPrompt = `你是一个专业的牙科正畸专家，需要根据参考平面与牙模的接触点数据生成最优的唇弓路径。

接触点数据：
${JSON.stringify(contactPointsData, null, 2)}

请分析这些接触点，并选择最合适的点来生成一条平滑、符合正畸学原理的唇弓路径。考虑以下因素：
1. 接触点的分布和密度
2. 唇弓的生理曲线特征
3. 正畸治疗的最佳路径
4. 避免过于尖锐的转折

请返回一个JSON格式的响应，包含：
{
  "selectedPoints": [
    {"x": 数值, "y": 数值, "z": 数值},
    ...
  ],
  "reasoning": "选择这些点的理由说明",
  "pathType": "路径类型描述（如：平滑曲线、抛物线等）"
}

请确保selectedPoints数组包含8-15个点，这些点应该能够形成一条平滑的唇弓路径。`;

    const prompt = customPrompt || defaultPrompt;
    
    try {
        setAIStatus('正在调用Gemini API生成路径...');
        const generateAiPathBtn = document.getElementById('generate-ai-path');
        generateAiPathBtn.disabled = true;
        
        // 这里应该调用实际的AI API
        // const response = await callGeminiAPI(apiKey, prompt, contactPointsData);
        // const aiResult = parseAIResponse(response);
        
        // 临时使用模拟数据
        const mockSelectedPoints = contactPoints.slice(0, 10).map(point => ({
            x: point.x,
            y: point.y,
            z: point.z
        }));
        
        if (mockSelectedPoints && mockSelectedPoints.length > 0) {
            // 生成路径
            generatePathFromAISelection(mockSelectedPoints);
            setAIStatus(`AI已生成包含 ${mockSelectedPoints.length} 个点的路径。`);
        } else {
            throw new Error('AI返回的数据格式不正确');
        }
        
    } catch (error) {
        console.error('AI路径生成失败:', error);
        setAIStatus(`AI路径生成失败: ${error.message}`, true);
    } finally {
        const generateAiPathBtn = document.getElementById('generate-ai-path');
        generateAiPathBtn.disabled = false;
        updateAIModeButtons();
    }
}

function generatePathFromAISelection(selectedPoints) {
    if (!selectedPoints || selectedPoints.length < 2) {
        setAIStatus('AI选择的点数量不足', true);
        return;
    }
    
    // 将AI选择的点转换为THREE.Vector3对象
    const aiPoints = selectedPoints.map(point => new THREE.Vector3(point.x, point.y, point.z));
    
    // 使用平滑曲线算法生成更多点
    const smoothPoints = pathModule.generateSmoothCurve(aiPoints);
    
    // 清除现有路径并设置新路径
    pathModule.saveState();
    pathModule.points = smoothPoints;
    pathModule.redrawScene();
    
    coreModule.setStatus(`AI已生成包含 ${smoothPoints.length} 个点的平滑路径`);
}

function setAIStatus(message, isError = false) {
    const aiStatusEl = document.getElementById('ai-status');
    aiStatusEl.textContent = message;
    aiStatusEl.className = `text-xs ${isError ? 'text-red-300' : 'text-blue-300'}`;
    aiStatusEl.classList.remove('hidden');
}

// 导出接触点
function exportContactPointsToJSON() {
    const contactPoints = planeModule.getContactPoints();
    if (contactPoints.length === 0) {
        setAIStatus('没有接触点可导出', true);
        return;
    }
    
    const contactPointsData = {
        contactPoints: contactPoints.map(point => ({
            x: point.x,
            y: point.y,
            z: point.z
        })),
        referencePlane: planeModule.getReferencePlaneData(),
        metadata: {
            totalPoints: contactPoints.length,
            exportTime: new Date().toISOString(),
            description: "参考平面与牙模的接触点数据"
        }
    };
    
    // 创建下载链接
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(contactPointsData, null, 2)], { type: 'application/json' }));
    a.download = 'contact_points.json';
    a.click();
    URL.revokeObjectURL(a.href);
    
    setAIStatus(`已导出 ${contactPoints.length} 个接触点到 contact_points.json`);
}

// 导出AI响应
function exportLastAIResponse() {
    if (!pathModule.lastAIResponse) {
        setAIStatus('没有可导出的AI响应数据', true);
        return;
    }
    
    try {
        const blob = new Blob([JSON.stringify(pathModule.lastAIResponse, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai_response_manual_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        setAIStatus('AI响应已导出');
    } catch (error) {
        console.error('导出AI响应失败:', error);
        setAIStatus('导出AI响应失败', true);
    }
}

// 导出JSON
function exportJSON() {
    if (pathModule.points.length === 0) return;
    
    // 构建导出数据，包含路径点和参考平面信息
    const data = { 
        points: pathModule.points.map(p => ({ x: p.x, y: p.y, z: p.z })),
        referencePlane: planeModule.getReferencePlaneData()
    };
    
    coreModule.exportJSON(data);
}

// 导入JSON
function importJSONFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const json = JSON.parse(e.target.result);
            if (Array.isArray(json.points)) {
                pathModule.saveStateIfPoints();
                pathModule.points = json.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
                
                // 导入参考平面数据
                if (json.referencePlane) {
                    if (planeModule.restoreReferencePlane(json.referencePlane)) {
                        coreModule.setStatus('设计和参考平面导入成功');
                    } else {
                        coreModule.setStatus('设计导入成功');
                    }
                } else {
                    coreModule.setStatus('设计导入成功');
                }
                
                pathModule.redrawScene();
            } else {
                coreModule.setStatus('导入失败：JSON格式不正确');
            }
        } catch (err) {
            console.error(err);
            coreModule.setStatus('导入失败：无效JSON');
        }
    };
    reader.readAsText(file);
}

// 事件绑定
function wireEvents() {
    const stlInput = document.getElementById('stl-input');
    const jsonImport = document.getElementById('json-import');
    const exportBtn = document.getElementById('export-json');
    const opacitySlider = document.getElementById('opacity');
    const enterPlaneBtn = document.getElementById('enter-plane-mode');
    const confirmPlaneBtn = document.getElementById('confirm-plane');
    const togglePlaneVisibilityBtn = document.getElementById('toggle-plane-visibility');
    const designModeSelect = document.getElementById('design-mode');
    const toggleDrawBtn = document.getElementById('toggle-draw');
    const toggleEditBtn = document.getElementById('toggle-edit');
    const clearAllBtn = document.getElementById('clear-all');
    const generateUloopBtn = document.getElementById('generate-uloop');
    const undoBtn = document.getElementById('undo');
    
    // AI Generation UI elements
    const generateAiPathBtn = document.getElementById('generate-ai-path');
    const exportContactPointsBtn = document.getElementById('export-contact-points');
    const exportAiResponseBtn = document.getElementById('export-ai-response');
    const geminiApiKeyInput = document.getElementById('gemini-api-key');
    const aiPromptInput = document.getElementById('ai-prompt');
    
    // 文件操作
    stlInput.addEventListener('change', (e) => coreModule.loadSTLFile(e.target.files?.[0]));
    jsonImport.addEventListener('change', (e) => importJSONFile(e.target.files?.[0]));
    exportBtn.addEventListener('click', exportJSON);
    
    // 透明度控制
    opacitySlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        if (coreModule.getModelMesh() && coreModule.getModelMesh().material) {
            coreModule.getModelMesh().material.opacity = value;
            coreModule.getModelMesh().material.transparent = value < 1;
        }
    });
    
    // 平面控制
    enterPlaneBtn.addEventListener('click', () => planeModule.enterPlaneMode());
    confirmPlaneBtn.addEventListener('click', () => planeModule.confirmPlane());
    togglePlaneVisibilityBtn.addEventListener('click', () => planeModule.togglePlaneVisibility());
    
    // 设计模式切换
    designModeSelect.addEventListener('change', () => {
        const mode = designModeSelect.value;
        if (mode === 'contact-points') {
            pathModule.toggleContactPointsMode();
        } else if (mode === 'parabola') {
            if (pathModule.getIsContactPointsMode()) pathModule.toggleContactPointsMode();
            if (pathModule.getIsAIGenerationMode()) pathModule.exitAIGenerationMode();
            pathModule.enterParabolaMode();
        } else if (mode === 'ai-generation') {
            if (pathModule.getIsContactPointsMode()) pathModule.toggleContactPointsMode();
            if (pathModule.getIsParabolaMode()) pathModule.exitParabolaMode();
            pathModule.enterAIGenerationMode();
        } else {
            if (pathModule.getIsContactPointsMode()) {
                pathModule.toggleContactPointsMode(); // 退出接触点模式
            }
            if (pathModule.getIsParabolaMode()) {
                pathModule.exitParabolaMode();
            }
            if (pathModule.getIsAIGenerationMode()) {
                pathModule.exitAIGenerationMode();
            }
            pathModule.updateArchCurve();
        }
    });
    
    // 路径设计控制
    toggleDrawBtn.addEventListener('click', () => pathModule.toggleDrawMode());
    toggleEditBtn.addEventListener('click', () => pathModule.toggleEditMode());
    clearAllBtn.addEventListener('click', () => { 
        pathModule.saveStateIfPoints(); 
        pathModule.clearDrawing(); 
    });
    generateUloopBtn.addEventListener('click', () => pathModule.generateULoopFromSelection());
    undoBtn.addEventListener('click', () => pathModule.undo());
    
    // AI模式事件监听
    generateAiPathBtn.addEventListener('click', generateAIPath);
    exportContactPointsBtn.addEventListener('click', exportContactPointsToJSON);
    exportAiResponseBtn.addEventListener('click', exportLastAIResponse);
    geminiApiKeyInput.addEventListener('input', updateAIModeButtons);
    aiPromptInput.addEventListener('input', () => {
        // 可以在这里添加实时验证或其他逻辑
    });
    
    // 设计UI锁定直到平面确认
    disableDesignUI(true);
}

// 设置鼠标事件处理
function setupMouseHandlers() {
    coreModule.onCanvasMouseDown = handleCanvasMouseDown;
    coreModule.onCanvasMouseUp = handleCanvasMouseUp;
}

// 初始化
function init() {
    setupModuleCallbacks();
    setupMouseHandlers();
    coreModule.initScene();
    wireEvents();
}

// 启动应用
init();
