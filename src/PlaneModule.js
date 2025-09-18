import * as THREE from 'three';
import { DragControls } from 'three/addons/controls/DragControls.js';

export class PlaneModule {
    constructor(coreModule) {
        this.core = coreModule;
        
        // 平面相关变量
        this.planeControlPoints = [];
        this.referencePlaneMesh = null;
        this.planeNormal = new THREE.Vector3(0, 1, 0);
        this.planeDragControls = null;
        this.isPlaneMode = false;
        
        // 接触点相关变量
        this.contactPoints = [];
        this.contactPointMarkers = [];
        this.selectedContactPoints = [];
        this.CONTACT_POINT_COLOR = 0x00FF00; // 绿色
        this.SELECTED_CONTACT_POINT_COLOR = 0xFF6600; // 橙色
        
        // UI元素
        this.planeStatusEl = document.getElementById('plane-status');
        this.enterPlaneBtn = document.getElementById('enter-plane-mode');
        this.confirmPlaneBtn = document.getElementById('confirm-plane');
        this.togglePlaneVisibilityBtn = document.getElementById('toggle-plane-visibility');
        
        // 回调函数
        this.onPlaneConfirmed = null;
        this.onContactPointsCalculated = null;
    }

    enablePlaneUI() {
        this.enterPlaneBtn.disabled = false;
        this.confirmPlaneBtn.disabled = true;
        this.togglePlaneVisibilityBtn.disabled = true;
        this.togglePlaneVisibilityBtn.textContent = '隐藏平面';
        this.planeStatusEl.textContent = '请在牙模上点击3个点来定义平面。';
    }

    enterPlaneMode() {
        this.isPlaneMode = true;
        this.planeStatusEl.textContent = `请在牙模上点击 ${Math.max(0, 3 - this.planeControlPoints.length)} 个点来定义平面。`;
        this.setupPlaneDragControls();
    }

    confirmPlane() {
        this.isPlaneMode = false;
        this.planeStatusEl.textContent = '参考平面已确认。';
        if (this.planeDragControls) {
            this.planeDragControls.dispose();
            this.planeDragControls = null;
        }
        if (this.onPlaneConfirmed) this.onPlaneConfirmed();
    }

    togglePlaneVisibility() {
        if (!this.referencePlaneMesh) return;
        this.referencePlaneMesh.visible = !this.referencePlaneMesh.visible;
        this.togglePlaneVisibilityBtn.textContent = this.referencePlaneMesh.visible ? '隐藏平面' : '显示平面';
    }

    addPlaneControlPoint(position) {
        if (this.planeControlPoints.length >= 3) return;
        const geometry = new THREE.SphereGeometry(0.4, 32, 32);
        const material = new THREE.MeshBasicMaterial({ color: 0x00FFFF });
        const point = new THREE.Mesh(geometry, material);
        point.position.copy(position);
        this.core.getScene().add(point);
        this.planeControlPoints.push(point);
        this.planeStatusEl.textContent = `请在牙模上点击 ${Math.max(0, 3 - this.planeControlPoints.length)} 个点来定义平面。`;
        if (this.planeControlPoints.length === 3) {
            this.updateReferencePlane();
            this.confirmPlaneBtn.disabled = false;
            this.planeStatusEl.textContent = '平面已定义。可拖动控制点调整，或点击"确认平面"。';
        }
    }

    setupPlaneDragControls() {
        if (this.planeDragControls) this.planeDragControls.dispose();
        this.planeDragControls = new DragControls(this.planeControlPoints, this.core.getCamera(), this.core.getRenderer().domElement);
        this.planeDragControls.addEventListener('dragstart', () => { this.core.getControls().enabled = false; });
        this.planeDragControls.addEventListener('drag', () => this.updateReferencePlane());
        this.planeDragControls.addEventListener('dragend', () => { this.core.getControls().enabled = true; });
    }

    updateReferencePlane() {
        if (this.planeControlPoints.length < 3) return;
        const [p1, p2, p3] = this.planeControlPoints.map(p => p.position);
        const plane = new THREE.Plane().setFromCoplanarPoints(p1, p2, p3);
        this.planeNormal.copy(plane.normal);
        if (!this.referencePlaneMesh) {
            const planeGeom = new THREE.PlaneGeometry(200, 200);
            const planeMat = new THREE.MeshStandardMaterial({ color: 0x00FFFF, opacity: 0.3, transparent: true, side: THREE.DoubleSide });
            this.referencePlaneMesh = new THREE.Mesh(planeGeom, planeMat);
            this.core.getScene().add(this.referencePlaneMesh);
        }
        this.referencePlaneMesh.position.copy(p1);
        this.referencePlaneMesh.lookAt(p1.clone().add(plane.normal));
    }

    // 计算参考平面与模型的接触点
    calculateContactPoints() {
        if (!this.core.getModelMesh() || !this.referencePlaneMesh) return;
        
        // 清除现有的接触点
        this.clearContactPoints();
        
        const geometry = this.core.getModelMesh().geometry;
        const positionAttribute = geometry.getAttribute('position');
        const positions = positionAttribute.array;
        
        // 获取参考平面的参数
        const planePosition = this.referencePlaneMesh.position;
        const planeNormal = new THREE.Vector3();
        this.referencePlaneMesh.getWorldDirection(planeNormal);
        planeNormal.negate(); // 获取正确的法线方向
        
        // 创建平面对象用于距离计算
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, planePosition);
        
        // 存储候选接触点
        const candidatePoints = [];
        const tolerance = 0.5; // 容差，单位：mm
        
        // 遍历所有顶点
        for (let i = 0; i < positions.length; i += 3) {
            const vertex = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
            
            // 将顶点转换到世界坐标
            vertex.applyMatrix4(this.core.getModelMesh().matrixWorld);
            
            // 计算顶点到平面的距离
            const distance = Math.abs(plane.distanceToPoint(vertex));
            
            // 如果距离在容差范围内，认为是接触点
            if (distance <= tolerance) {
                candidatePoints.push(vertex.clone());
            }
        }
        
        // 对候选点进行聚类，避免重复点
        const clusteredPoints = this.clusterPoints(candidatePoints, 1.0); // 1mm聚类半径
        
        // 对接触点进行排序，使用TSP最短路径算法
        const sortedPoints = this.sortContactPointsByTSP(clusteredPoints);
        
        // 创建接触点标记
        sortedPoints.forEach(point => {
            this.createContactPointMarker(point);
            this.contactPoints.push(point);
        });
        
        this.core.setStatus(`找到 ${this.contactPoints.length} 个接触点`);
        
        if (this.onContactPointsCalculated) this.onContactPointsCalculated();
    }

    // 使用TSP最短路径算法对接触点进行排序
    sortContactPointsByTSP(points) {
        if (points.length <= 2) return points;
        
        // 使用贪心算法实现TSP
        const sortedPoints = [];
        const remainingPoints = [...points];
        
        // 选择第一个点作为起始点
        let currentPoint = remainingPoints[0];
        sortedPoints.push(currentPoint);
        remainingPoints.splice(0, 1);
        
        // 贪心选择最近的点
        while (remainingPoints.length > 0) {
            let closestIndex = 0;
            let minDistance = currentPoint.distanceTo(remainingPoints[0]);
            
            // 找到距离当前点最近的点
            for (let i = 1; i < remainingPoints.length; i++) {
                const distance = currentPoint.distanceTo(remainingPoints[i]);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestIndex = i;
                }
            }
            
            // 添加最近的点
            currentPoint = remainingPoints[closestIndex];
            sortedPoints.push(currentPoint);
            remainingPoints.splice(closestIndex, 1);
        }
        
        return sortedPoints;
    }

    // 点聚类函数
    clusterPoints(points, radius) {
        const clusters = [];
        const used = new Set();
        
        for (let i = 0; i < points.length; i++) {
            if (used.has(i)) continue;
            
            const cluster = [points[i]];
            used.add(i);
            
            // 找到所有在半径内的点
            for (let j = i + 1; j < points.length; j++) {
                if (used.has(j)) continue;
                
                if (points[i].distanceTo(points[j]) <= radius) {
                    cluster.push(points[j]);
                    used.add(j);
                }
            }
            
            // 计算聚类中心
            const center = new THREE.Vector3();
            cluster.forEach(point => center.add(point));
            center.divideScalar(cluster.length);
            
            clusters.push(center);
        }
        
        return clusters;
    }

    // 创建接触点标记
    createContactPointMarker(position) {
        const geometry = new THREE.SphereGeometry(0.3, 16, 16);
        const material = new THREE.MeshBasicMaterial({ color: this.CONTACT_POINT_COLOR });
        const marker = new THREE.Mesh(geometry, material);
        marker.position.copy(position);
        marker.userData = { type: 'contactPoint', index: this.contactPoints.length };
        this.core.getScene().add(marker);
        this.contactPointMarkers.push(marker);
    }

    // 清除接触点
    clearContactPoints() {
        this.contactPointMarkers.forEach(marker => this.core.getScene().remove(marker));
        this.contactPointMarkers = [];
        this.contactPoints = [];
        this.selectedContactPoints = [];
    }

    resetPlane() {
        this.planeControlPoints.forEach(p => this.core.getScene().remove(p));
        this.planeControlPoints = [];
        if (this.referencePlaneMesh) {
            this.core.getScene().remove(this.referencePlaneMesh);
            this.referencePlaneMesh.geometry?.dispose?.();
            this.referencePlaneMesh.material?.dispose?.();
            this.referencePlaneMesh = null;
        }
        this.confirmPlaneBtn.disabled = true;
        this.togglePlaneVisibilityBtn.disabled = true;
    }

    // 处理平面模式的鼠标点击
    handlePlaneModeClick() {
        if (!this.isPlaneMode || this.planeControlPoints.length >= 3) return;
        
        const raycaster = this.core.getRaycaster();
        const mouse = this.core.getMouse();
        const camera = this.core.getCamera();
        const modelMesh = this.core.getModelMesh();
        
        if (!modelMesh) return;
        
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(modelMesh);
        if (intersects.length > 0) {
            this.addPlaneControlPoint(intersects[0].point);
        }
    }

    // 处理接触点选择
    handleContactPointSelection() {
        const raycaster = this.core.getRaycaster();
        const mouse = this.core.getMouse();
        const camera = this.core.getCamera();
        
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(this.contactPointMarkers);
        if (intersects.length === 0) return;
        
        const marker = intersects[0].object;
        const index = marker.userData.index;
        
        // 如果已经选择了这个点，取消选择
        if (this.selectedContactPoints.includes(index)) {
            this.selectedContactPoints = this.selectedContactPoints.filter(i => i !== index);
            marker.material.color.set(this.CONTACT_POINT_COLOR);
            this.core.setStatus(`已取消选择接触点 ${index + 1}，当前选择：${this.selectedContactPoints.length}/2`);
            return;
        }
        
        // 如果已经选择了两个点，先清除选择
        if (this.selectedContactPoints.length >= 2) {
            this.selectedContactPoints.forEach(i => {
                this.contactPointMarkers[i].material.color.set(this.CONTACT_POINT_COLOR);
            });
            this.selectedContactPoints = [];
        }
        
        // 选择新点
        this.selectedContactPoints.push(index);
        marker.material.color.set(this.SELECTED_CONTACT_POINT_COLOR);
        
        this.core.setStatus(`已选择接触点 ${index + 1}，当前选择：${this.selectedContactPoints.length}/2`);
    }

    // 获取接触点数据
    getContactPoints() {
        return this.contactPoints;
    }

    getSelectedContactPoints() {
        return this.selectedContactPoints;
    }

    getReferencePlaneData() {
        if (!this.referencePlaneMesh || this.planeControlPoints.length !== 3) {
            return null;
        }
        
        return {
            controlPoints: this.planeControlPoints.map(p => ({ 
                x: p.position.x, 
                y: p.position.y, 
                z: p.position.z 
            })),
            normal: {
                x: this.planeNormal.x,
                y: this.planeNormal.y,
                z: this.planeNormal.z
            },
            position: {
                x: this.referencePlaneMesh.position.x,
                y: this.referencePlaneMesh.position.y,
                z: this.referencePlaneMesh.position.z
            },
            visible: this.referencePlaneMesh.visible
        };
    }

    // 恢复参考平面数据
    restoreReferencePlane(planeData) {
        if (!planeData || !Array.isArray(planeData.controlPoints) || planeData.controlPoints.length !== 3) {
            return false;
        }
        
        // 清除现有参考平面
        this.resetPlane();
        
        // 恢复控制点
        planeData.controlPoints.forEach(pointData => {
            const position = new THREE.Vector3(pointData.x, pointData.y, pointData.z);
            this.addPlaneControlPoint(position);
        });
        
        // 恢复平面法线
        if (planeData.normal) {
            this.planeNormal.set(planeData.normal.x, planeData.normal.y, planeData.normal.z);
        }
        
        // 确认平面状态（这会创建referencePlaneMesh）
        this.confirmPlane();
        
        // 恢复平面位置和可见性
        if (this.referencePlaneMesh && planeData.position) {
            this.referencePlaneMesh.position.set(
                planeData.position.x, 
                planeData.position.y, 
                planeData.position.z
            );
        }
        
        if (this.referencePlaneMesh && typeof planeData.visible === 'boolean') {
            this.referencePlaneMesh.visible = planeData.visible;
            this.togglePlaneVisibilityBtn.textContent = this.referencePlaneMesh.visible ? '隐藏平面' : '显示平面';
        }
        
        return true;
    }

    // 获取平面模式状态
    getIsPlaneMode() {
        return this.isPlaneMode;
    }
}
