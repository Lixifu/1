import * as THREE from 'three';
import { DragControls } from 'three/addons/controls/DragControls.js';

export class PathModule {
    constructor(coreModule, planeModule) {
        this.core = coreModule;
        this.plane = planeModule;
        
        // 路径相关变量
        this.points = [];
        this.archCurveObject = null;
        this.pointMarkers = [];
        this.draggableObjects = [];
        this.dragControls = null;
        
        // 模式状态
        this.isDrawingMode = false;
        this.isEditMode = false;
        this.isContactPointsMode = false;
        this.isHyperbolaMode = false;
        this.isParabolaMode = false;
        this.isAIGenerationMode = false;
        this.lastAIResponse = null;
        
        // U-loop选择
        this.SELECTION_COLOR_ULOOP = 0x9932CC;
        this.SELECTION_COLOR_ULOOP_MIDDLE = 0xFFA500;
        this.uLoopSelectionIndices = [];
        
        // 双曲线模式状态
        this.hyperbolaSelectedContactPoints = [];
        this.hyperbolaShortCurvePoints = [];
        this.hyperbolaGuideLine = null;
        this.HYPERBOLA_SAMPLE_COLOR = 0x00BFFF;
        
        // 抛物线模式状态
        this.parabolaPickedPoints = [];
        this.parabolaMarkers = [];
        this.PARABOLA_MARKER_COLOR = 0x00BFFF;
        
        // 撤销历史
        this.historyStack = [];
        
        // UI元素
        this.designModeSelect = document.getElementById('design-mode');
        this.toggleDrawBtn = document.getElementById('toggle-draw');
        this.toggleEditBtn = document.getElementById('toggle-edit');
        this.clearAllBtn = document.getElementById('clear-all');
        this.generateUloopBtn = document.getElementById('generate-uloop');
        this.undoBtn = document.getElementById('undo');
        
        // AI Generation UI elements
        this.aiModeUI = document.getElementById('ai-mode-ui');
        this.geminiApiKeyInput = document.getElementById('gemini-api-key');
        this.aiPromptInput = document.getElementById('ai-prompt');
        this.generateAiPathBtn = document.getElementById('generate-ai-path');
        this.exportContactPointsBtn = document.getElementById('export-contact-points');
        this.exportAiResponseBtn = document.getElementById('export-ai-response');
        this.aiStatusEl = document.getElementById('ai-status');
        
        // 回调函数
        this.onPathUpdated = null;
        this.onExportAvailabilityChanged = null;
    }

    // 模式切换
    toggleDrawMode() {
        this.isDrawingMode = !this.isDrawingMode;
        if (this.isDrawingMode) this.isEditMode = false;
        this.deselectAllPoints();
        this.updateModeButtons();
    }

    toggleEditMode() {
        this.isEditMode = !this.isEditMode;
        if (this.isEditMode) this.isDrawingMode = false;
        this.updateModeButtons();
    }

    toggleContactPointsMode() {
        this.isContactPointsMode = !this.isContactPointsMode;
        if (this.isContactPointsMode) {
            this.isDrawingMode = false;
            this.isEditMode = false;
            // 计算并显示接触点
            this.plane.calculateContactPoints();
        } else {
            // 清除接触点
            this.plane.clearContactPoints();
        }
        this.updateModeButtons();
    }

    enterParabolaMode() {
        this.isParabolaMode = true;
        this.isDrawingMode = false;
        this.isEditMode = false;
        this.clearParabolaWorkingState();
        this.updateModeButtons();
    }

    exitParabolaMode() {
        this.isParabolaMode = false;
        this.clearParabolaWorkingState();
        this.updateModeButtons();
    }

    enterAIGenerationMode() {
        this.isAIGenerationMode = true;
        this.isDrawingMode = false;
        this.isEditMode = false;
        this.isContactPointsMode = false;
        this.isParabolaMode = false;
        // 显示AI模式UI
        this.aiModeUI.classList.remove('hidden');
        // 计算并显示接触点
        this.plane.calculateContactPoints();
        this.updateModeButtons();
        this.updateAIModeButtons();
    }

    exitAIGenerationMode() {
        this.isAIGenerationMode = false;
        // 隐藏AI模式UI
        this.aiModeUI.classList.add('hidden');
        // 清除接触点
        this.plane.clearContactPoints();
        this.updateModeButtons();
    }

    updateModeButtons() {
        if (this.isDrawingMode) {
            this.toggleDrawBtn.textContent = '结束绘制';
            this.core.setStatus('绘制模式：单击牙模添加点。');
        } else {
            this.toggleDrawBtn.textContent = '开始绘制';
        }
        if (this.isEditMode) {
            this.core.setStatus('编辑模式：拖动点修改路径。按住Shift单击选择三个端点。');
        }
        if (this.isContactPointsMode) {
            this.core.setStatus('接触点模式：单击接触点选择起点和终点。');
        }
        if (this.isParabolaMode) {
            this.core.setStatus('抛物线模式：在牙模上点击选择3个点进行拟合。');
        }
        if (this.isAIGenerationMode) {
            this.core.setStatus('AI生成模式：自动分析接触点并生成最优路径。');
        }
        if (!this.isDrawingMode && !this.isEditMode && !this.plane.getIsPlaneMode() && !this.isContactPointsMode && !this.isHyperbolaMode && !this.isAIGenerationMode) {
            this.core.setStatus('请选择操作模式。');
        }
    }

    updateAIModeButtons() {
        const hasApiKey = this.geminiApiKeyInput.value.trim().length > 0;
        const hasContactPoints = this.plane.getContactPoints().length > 0;
        const hasAIResponse = this.lastAIResponse !== null;
        
        this.generateAiPathBtn.disabled = !hasApiKey || !hasContactPoints;
        this.exportContactPointsBtn.disabled = !hasContactPoints;
        this.exportAiResponseBtn.disabled = !hasAIResponse;
    }

    // 路径绘制和编辑
    addPointAtCursor() {
        if (!this.core.getModelMesh()) return;
        const raycaster = this.core.getRaycaster();
        const mouse = this.core.getMouse();
        const camera = this.core.getCamera();
        const modelMesh = this.core.getModelMesh();
        
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(modelMesh);
        if (intersects.length === 0) return;
        
        this.saveState();
        const offsetPoint = this.getOffsetPoint(intersects[0]);
        
        // 如果points数组为空，直接添加
        if (this.points.length === 0) {
            this.points.push(offsetPoint);
        } else {
            // 计算新点到路径两端点的距离
            const distanceToStart = offsetPoint.distanceTo(this.points[0]);
            const distanceToEnd = offsetPoint.distanceTo(this.points[this.points.length - 1]);
            
            // 根据距离决定插入位置
            if (distanceToStart <= distanceToEnd) {
                // 距离起点更近，插入到开头
                this.points.unshift(offsetPoint);
            } else {
                // 距离终点更近，插入到末尾
                this.points.push(offsetPoint);
            }
        }
        
        this.redrawScene();
    }

    getOffsetPoint(intersect) {
        const surfacePoint = intersect.point;
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(intersect.object.matrixWorld);
        const worldNormal = intersect.face.normal.clone().applyMatrix3(normalMatrix).normalize();
        const offsetVector = worldNormal.multiplyScalar(this.core.getWireRadius());
        return surfacePoint.clone().add(offsetVector);
    }

    redrawScene() {
        // 清理标记
        this.pointMarkers.forEach(m => this.core.getScene().remove(m));
        this.pointMarkers = [];
        this.draggableObjects = [];
        this.points.forEach((p, i) => this.addPointMarker(p, i));
        this.updateArchCurve();
        this.setupPointDragControls();
        this.updateExportAvailability();
        this.updateUndoBtn();
        if (this.onPathUpdated) this.onPathUpdated();
    }

    addPointMarker(position, index) {
        const isULoopInternal = position.userData && position.userData.isULoopInternal;
        const isSelected = this.uLoopSelectionIndices.includes(index);
        const markerGeometry = new THREE.SphereGeometry(this.core.getMarkerRadius(), 16, 16);
        const markerMaterial = new THREE.MeshBasicMaterial({ color: isSelected ? this.SELECTION_COLOR_ULOOP : 0xff0000 });
        const marker = new THREE.Mesh(markerGeometry, markerMaterial);
        marker.position.copy(position);
        marker.userData = { ...(position.userData || {}), index };
        this.core.getScene().add(marker);
        this.pointMarkers.push(marker);
        if (!isULoopInternal) {
            this.draggableObjects.push(marker);
        } else {
            marker.visible = false;
        }
    }

    setupPointDragControls() {
        if (this.dragControls) this.dragControls.dispose();
        this.dragControls = new DragControls(this.draggableObjects, this.core.getCamera(), this.core.getRenderer().domElement);
        this.dragControls.addEventListener('dragstart', () => { 
            this.core.getControls().enabled = false; 
            this.saveState(); 
        });
        this.dragControls.addEventListener('drag', (event) => {
            const idx = event.object.userData.index;
            if (typeof idx === 'number') {
                this.points[idx].copy(event.object.position);
                this.updateArchCurve();
            }
        });
        this.dragControls.addEventListener('dragend', (event) => {
            this.core.getControls().enabled = true;
            const idx = event.object.userData.index;
            if (this.uLoopSelectionIndices.includes(idx)) {
                event.object.material.color.set(this.SELECTION_COLOR_ULOOP);
            } else {
                event.object.material.color.set(0xff0000);
            }
        });
    }

    updateArchCurve() {
        if (this.archCurveObject) {
            this.core.getScene().remove(this.archCurveObject);
            this.archCurveObject.geometry?.dispose?.();
            this.archCurveObject.material?.dispose?.();
            this.archCurveObject = null;
        }
        if (this.points.length < 2) return;
        
        const curve = new THREE.CatmullRomCurve3(this.points, false, 'catmullrom', 0.5);
        const tubeGeometry = new THREE.TubeGeometry(curve, 512, this.core.getWireRadius(), 16, false);
        const tubeMaterial = new THREE.MeshStandardMaterial({ color: 0x00bfff, metalness: 0.5, roughness: 0.2, emissive: 0x112233 });
        this.archCurveObject = new THREE.Mesh(tubeGeometry, tubeMaterial);
        this.core.getScene().add(this.archCurveObject);
    }

    setMarkersVisibility(visible) {
        this.pointMarkers.forEach(m => m.visible = visible && !(m.userData && m.userData.isULoopInternal));
    }

    updateExportAvailability() {
        this.core.exportBtn.disabled = this.points.length === 0;
        if (this.onExportAvailabilityChanged) this.onExportAvailabilityChanged();
    }

    updateUndoBtn() {
        this.undoBtn.disabled = this.historyStack.length === 0;
    }

    // 清除功能
    clearDrawing() {
        this.deselectAllPoints();
        this.points = [];
        this.pointMarkers.forEach(m => this.core.getScene().remove(m));
        this.pointMarkers = [];
        this.draggableObjects = [];
        if (this.dragControls) {
            this.dragControls.dispose();
            this.dragControls = null;
        }
        if (this.archCurveObject) {
            this.core.getScene().remove(this.archCurveObject);
            this.archCurveObject.geometry?.dispose?.();
            this.archCurveObject.material?.dispose?.();
            this.archCurveObject = null;
        }
        // 清除接触点
        this.plane.clearContactPoints();
        // 清除双曲线工作态
        this.clearHyperbolaWorkingState();
        this.updateExportAvailability();
    }

    clearHyperbolaWorkingState() {
        this.resetHyperbolaContactSelectionColors();
        this.hyperbolaSelectedContactPoints = [];
        this.hyperbolaShortCurvePoints = [];
        if (this.hyperbolaGuideLine) {
            this.core.getScene().remove(this.hyperbolaGuideLine);
            this.hyperbolaGuideLine.geometry?.dispose?.();
            this.hyperbolaGuideLine.material?.dispose?.();
            this.hyperbolaGuideLine = null;
        }
    }

    clearParabolaWorkingState() {
        this.parabolaPickedPoints = [];
        this.parabolaMarkers.forEach(m => { this.core.getScene().remove(m); });
        this.parabolaMarkers = [];
    }

    resetHyperbolaContactSelectionColors() {
        if (!this.plane.contactPointMarkers.length) return;
        this.plane.contactPointMarkers.forEach(m => m.material.color.set(this.plane.CONTACT_POINT_COLOR));
    }

    // U-loop功能
    handleULoopSelection(marker) {
        const index = marker.userData.index;
        const selectionIndex = this.uLoopSelectionIndices.indexOf(index);
        if (selectionIndex > -1) {
            this.uLoopSelectionIndices.splice(selectionIndex, 1);
            marker.material.color.set(0xff0000);
        } else {
            if (this.uLoopSelectionIndices.length >= 3) {
                // 如果已经选了三个点，先清除最早的点
                const oldIndex = this.uLoopSelectionIndices.shift();
                const oldMarker = this.draggableObjects.find(m => m.userData.index === oldIndex);
                if (oldMarker) oldMarker.material.color.set(0xff0000);
            }
            this.uLoopSelectionIndices.push(index);
            // 为不同位置的点设置不同颜色
            if (this.uLoopSelectionIndices.length === 3) {
                // 第一个点（起点）和最后一个点（终点）用紫色，中间点用橙色
                this.draggableObjects.forEach(m => {
                    if (m.userData.index === this.uLoopSelectionIndices[0] || m.userData.index === this.uLoopSelectionIndices[2]) {
                        m.material.color.set(this.SELECTION_COLOR_ULOOP);
                    } else if (m.userData.index === this.uLoopSelectionIndices[1]) {
                        m.material.color.set(this.SELECTION_COLOR_ULOOP_MIDDLE);
                    }
                });
            } else {
                marker.material.color.set(this.SELECTION_COLOR_ULOOP);
            }
        }
        this.generateUloopBtn.disabled = this.uLoopSelectionIndices.length !== 3;
    }

    deselectAllPoints() {
        this.uLoopSelectionIndices.forEach(i => {
            const marker = this.draggableObjects.find(m => m.userData.index === i);
            if (marker) marker.material.color.set(0xff0000);
        });
        this.uLoopSelectionIndices = [];
        this.generateUloopBtn.disabled = true;
    }

    generateULoopFromSelection() {
        if (this.uLoopSelectionIndices.length !== 3) return;
        this.saveState();
        // 保持三个点的顺序不变（起点、中间点、终点）
        const [index1, index2, index3] = this.uLoopSelectionIndices;
        const p_start = this.points[index1];
        const p_mid = this.points[index2]; // 这是U型曲的最低点
        const p_end = this.points[index3];

        // 根据三个点计算平面
        const newPoints = this.generateULoopFromThreePoints(p_start, p_mid, p_end);
        
        // 确定要替换的点范围
        const minIndex = Math.min(index1, index2, index3);
        const maxIndex = Math.max(index1, index2, index3);
        const pointsToRemove = maxIndex - minIndex - 1;
        this.points.splice(minIndex + 1, pointsToRemove, ...newPoints);
        this.deselectAllPoints();
        this.redrawScene();
    }

    generateULoopGeometry(baseStart, baseEnd, y_hat, height) {
        // 不添加额外的宽度偏移，直接使用原始端点作为U型曲的基础
        // Add height to arms
        const armTopStart = baseStart.clone().add(y_hat.clone().multiplyScalar(height));
        const armTopEnd = baseEnd.clone().add(y_hat.clone().multiplyScalar(height));
        
        // Apply end distance offset (move away from tissue surface) - fixed value since UI was removed
        const endOffset = y_hat.clone().multiplyScalar(1.0); // Using default value of 1.0mm
        armTopStart.add(endOffset);
        armTopEnd.add(endOffset);
        
        const loopPoints = [];
        armTopStart.userData = { type: 'uloop' };
        loopPoints.push(armTopStart);
        
        // Generate semicircle between arm tops
        const semicenter = armTopStart.clone().lerp(armTopEnd, 0.5);
        const startVec = new THREE.Vector3().subVectors(armTopStart, semicenter);
        const x_hat = new THREE.Vector3().subVectors(baseEnd, baseStart).normalize();
        const z_hat = new THREE.Vector3().crossVectors(x_hat, y_hat).normalize();
        const numSemicirclePoints = 16; // 半圆的点数量
        const midPointIndex = Math.floor(numSemicirclePoints / 2);
        
        // 修改角度计算方式，使半圆更加平滑和圆润
        for (let i = 1; i < numSemicirclePoints; i++) {
            const angle = -Math.PI * (i / numSemicirclePoints);
            const point = new THREE.Vector3().copy(startVec).applyAxisAngle(z_hat, angle).add(semicenter);
            if (i === midPointIndex) {
                point.userData = { type: 'uloop' };
            } else {
                point.userData = { isULoopInternal: true, type: 'uloop' };
            }
            loopPoints.push(point);
        }
        
        armTopEnd.userData = { type: 'uloop' };
        loopPoints.push(armTopEnd);
        return loopPoints;
    }

    // 新函数：从三个点生成U型曲
    generateULoopFromThreePoints(p_start, p_mid, p_end) {
        // 计算三个点所在平面的法线
        const v1 = new THREE.Vector3().subVectors(p_mid, p_start);
        const v2 = new THREE.Vector3().subVectors(p_end, p_start);
        const planeNormal = new THREE.Vector3().crossVectors(v1, v2).normalize();
        
        // 计算起点到终点的方向向量
        const x_hat = new THREE.Vector3().subVectors(p_end, p_start).normalize();
        // 计算在平面内垂直于x_hat的向量
        const y_hat = new THREE.Vector3().crossVectors(planeNormal, x_hat).normalize();
        
        // 确保y_hat指向正确的方向（朝向最低点）
        const curveMidpoint = p_start.clone().lerp(p_end, 0.5);
        const toMidPoint = new THREE.Vector3().subVectors(p_mid, curveMidpoint);
        if (y_hat.dot(toMidPoint) < 0) {
            y_hat.negate();
        }
        
        // 计算U型曲的高度（两端端点的中心点到底部端点的距离减去两端端点之间长度的一半）
        const startToEndDistance = p_start.distanceTo(p_end);
        const height = toMidPoint.length() - startToEndDistance / 2;
        
        // 使用修改后的generateULoopGeometry生成U型曲
        const newPoints = this.generateULoopGeometry(p_start, p_end, y_hat, height);
        
        return newPoints;
    }

    // 撤销功能
    saveState() {
        const state = {
            points: this.points.map(p => {
                const np = p.clone();
                if (p.userData) np.userData = { ...p.userData };
                return np;
            })
        };
        this.historyStack.push(state);
        this.updateUndoBtn();
    }

    saveStateIfPoints() {
        if (this.points.length > 0) this.saveState();
    }

    undo() {
        if (this.historyStack.length === 0) return;
        const prev = this.historyStack.pop();
        this.points = prev.points.map(p => {
            const np = p.clone();
            if (p.userData) np.userData = { ...p.userData };
            return np;
        });
        this.undoBtn.disabled = this.historyStack.length === 0;
        this.deselectAllPoints();
        this.redrawScene();
    }

    // 接触点路径生成
    generatePathFromContactPoints() {
        if (this.plane.getSelectedContactPoints().length !== 2) return;
        
        const startIndex = this.plane.getSelectedContactPoints()[0];
        const endIndex = this.plane.getSelectedContactPoints()[1];
        
        // 直接使用接触点，选择两点之间的短曲线
        const pathPoints = this.getCurvePointsBetweenIndices(this.plane.getContactPoints(), startIndex, endIndex);
        
        if (pathPoints.length < 2) {
            this.core.setStatus('无法生成路径：未找到有效的接触点');
            return;
        }
        
        // 限制路径点数量为控制点数量
        const limitedPoints = this.limitPathPoints(pathPoints, this.core.getControlPointsCount());
        
        // 使用平滑曲线算法生成更多点
        const smoothPoints = this.generateSmoothCurve(limitedPoints);
        
        // 清除现有路径并设置新路径
        this.saveState();
        this.points = smoothPoints;
        this.redrawScene();
        
        this.core.setStatus(`已生成包含 ${smoothPoints.length} 个点的平滑路径`);
    }

    getCurvePointsBetweenIndices(contactPoints, startIndex, endIndex) {
        const n = contactPoints.length;
        
        // 计算两个方向的距离
        const forwardDistance = (endIndex - startIndex + n) % n;
        const backwardDistance = (startIndex - endIndex + n) % n;
        
        // 选择较短的方向
        let selectedIndices;
        if (forwardDistance <= backwardDistance) {
            // 正向路径较短
            selectedIndices = [];
            for (let i = 0; i <= forwardDistance; i++) {
                selectedIndices.push((startIndex + i) % n);
            }
        } else {
            // 反向路径较短
            selectedIndices = [];
            for (let i = 0; i <= backwardDistance; i++) {
                selectedIndices.push((startIndex - i + n) % n);
            }
        }
        
        // 从选中的索引中提取点
        const selectedPoints = selectedIndices.map(index => contactPoints[index]);
        
        // 确保起点和终点都包含在路径中
        const resultPoints = [];
        resultPoints.push(contactPoints[startIndex]); // 确保起点
        
        // 添加中间点（如果起点和终点不是相邻的）
        if (selectedPoints.length > 2) {
            for (let i = 1; i < selectedPoints.length - 1; i++) {
                resultPoints.push(selectedPoints[i]);
            }
        }
        
        resultPoints.push(contactPoints[endIndex]); // 确保终点
        
        return resultPoints;
    }

    // 限制路径点数量
    limitPathPoints(points, maxPoints) {
        if (points.length <= maxPoints) {
            return points;
        }
        
        // 均匀选择指定数量的点
        const step = (points.length - 1) / (maxPoints - 1);
        const resultPoints = [];
        
        for (let i = 0; i < maxPoints; i++) {
            const index = Math.round(i * step);
            resultPoints.push(points[index].clone());
        }
        
        return resultPoints;
    }

    // 生成平滑曲线
    generateSmoothCurve(controlPoints) {
        if (controlPoints.length < 2) return controlPoints;
        
        // 使用CatmullRom曲线生成平滑路径
        const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'catmullrom', 0.5);
        
        // 使用用户设置的点数来创建平滑曲线
        const smoothPoints = curve.getPoints(this.core.getSmoothPointsCount());
        
        return smoothPoints;
    }

    // 抛物线模式处理
    handleParabolaMouseUp() {
        const raycaster = this.core.getRaycaster();
        const mouse = this.core.getMouse();
        const camera = this.core.getCamera();
        const modelMesh = this.core.getModelMesh();
        
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(modelMesh);
        if (intersects.length === 0) return;
        const p = this.getOffsetPoint(intersects[0]);
        this.addParabolaMarker(p);
        this.parabolaPickedPoints.push(p.clone());
        this.core.setStatus(`抛物线：已选择 ${this.parabolaPickedPoints.length}/3 个点`);
        if (this.parabolaPickedPoints.length === 3) {
            this.generateParabolaPath(this.parabolaPickedPoints[0], this.parabolaPickedPoints[1], this.parabolaPickedPoints[2]);
            this.clearParabolaWorkingState();
            this.core.setStatus('抛物线路径已生成。');
        }
    }

    addParabolaMarker(p) {
        const geom = new THREE.SphereGeometry(0.35, 16, 16);
        const mat = new THREE.MeshBasicMaterial({ color: this.PARABOLA_MARKER_COLOR });
        const marker = new THREE.Mesh(geom, mat);
        marker.position.copy(p);
        this.core.getScene().add(marker);
        this.parabolaMarkers.push(marker);
    }

    generateParabolaPath(p1, p2, p3) {
        // 三点定义平面
        const plane = new THREE.Plane().setFromCoplanarPoints(p1, p2, p3);
        const n = plane.normal.clone().normalize();
        // 在平面内设置基：u 沿 p1->p3，v = n x u
        let u = new THREE.Vector3().subVectors(p3, p1);
        // 去除法向分量确保在平面内
        u.sub(n.clone().multiplyScalar(u.dot(n)));
        const lenU = u.length();
        if (lenU < 1e-6) {
            // 若p1与p3过近，尝试使用p1->p2方向
            u = new THREE.Vector3().subVectors(p2, p1);
            u.sub(n.clone().multiplyScalar(u.dot(n)));
        }
        u.normalize();
        const v = new THREE.Vector3().crossVectors(n, u).normalize();
        const origin = p1.clone();
        // 投影到2D并以p1为原点
        const to2D = (p) => { const d = new THREE.Vector3().subVectors(p, origin); return { x: d.dot(u), y: d.dot(v) }; };
        const P1 = { x: 0, y: 0 };
        const P2 = to2D(p2);
        const P3 = to2D(p3);
        // 拟合 y = a x^2 + b x + c 通过三点
        const aMat = [
            [P1.x * P1.x, P1.x, 1],
            [P2.x * P2.x, P2.x, 1],
            [P3.x * P3.x, P3.x, 1]
        ];
        const yVec = [P1.y, P2.y, P3.y];
        const coeff = this.solve3x3(aMat, yVec);
        if (!coeff) {
            // 退化回CatmullRom通过三点
            const crv = new THREE.CatmullRomCurve3([p1, p2, p3], false, 'catmullrom', 0.5);
            const arr = crv.getPoints(this.core.getSmoothPointsCount());
            this.saveState(); this.points = arr; this.redrawScene();
            return;
        }
        const [a, b, c] = coeff;
        // 采样x从0到P3.x方向，保持与p1->p3一致的方向
        const xStart = 0;
        const xEnd = P3.x;
        const samples = [];
        for (let i = 0; i < this.core.getSmoothPointsCount(); i++) {
            const t = i / (this.core.getSmoothPointsCount() - 1);
            const x = xStart + (xEnd - xStart) * t;
            const y = a * x * x + b * x + c;
            samples.push({ x, y });
        }
        // 映射回3D
        const result3D = samples.map(p => origin.clone().add(u.clone().multiplyScalar(p.x)).add(v.clone().multiplyScalar(p.y)));
        this.saveState();
        this.points = result3D;
        this.redrawScene();
    }

    solve3x3(A, b) {
        // 解 Ax=b，直接求逆或克拉默法则
        const m = A;
        const d = this.det3(m);
        if (Math.abs(d) < 1e-9) return null;
        const inv = this.inv3(m);
        if (!inv) return null;
        const x = [
            inv[0][0] * b[0] + inv[0][1] * b[1] + inv[0][2] * b[2],
            inv[1][0] * b[0] + inv[1][1] * b[1] + inv[1][2] * b[2],
            inv[2][0] * b[0] + inv[2][1] * b[1] + inv[2][2] * b[2]
        ];
        return x;
    }

    det3(m) {
        return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
    }

    inv3(m) {
        const d = this.det3(m);
        if (Math.abs(d) < 1e-9) return null;
        const inv = [
            [
                (m[1][1]*m[2][2]-m[1][2]*m[2][1])/d,
                -(m[0][1]*m[2][2]-m[0][2]*m[2][1])/d,
                (m[0][1]*m[1][2]-m[0][2]*m[1][1])/d
            ],
            [
                -(m[1][0]*m[2][2]-m[1][2]*m[2][0])/d,
                (m[0][0]*m[2][2]-m[0][2]*m[2][0])/d,
                -(m[0][0]*m[1][2]-m[0][2]*m[1][0])/d
            ],
            [
                (m[1][0]*m[2][1]-m[1][1]*m[2][0])/d,
                -(m[0][0]*m[2][1]-m[0][1]*m[2][0])/d,
                (m[0][0]*m[1][1]-m[0][1]*m[1][0])/d
            ]
        ];
        return inv;
    }

    // 获取路径数据
    getPathData() {
        return {
            points: this.points.map(p => ({ x: p.x, y: p.y, z: p.z }))
        };
    }

    // 设置路径数据
    setPathData(data) {
        if (Array.isArray(data.points)) {
            this.points = data.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
            this.redrawScene();
            return true;
        }
        return false;
    }

    // 获取模式状态
    getIsDrawingMode() { return this.isDrawingMode; }
    getIsEditMode() { return this.isEditMode; }
    getIsContactPointsMode() { return this.isContactPointsMode; }
    getIsParabolaMode() { return this.isParabolaMode; }
    getIsAIGenerationMode() { return this.isAIGenerationMode; }
}
