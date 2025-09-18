import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DragControls } from 'three/addons/controls/DragControls.js';

export class CoreModule {
    constructor() {
        // 核心场景变量
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.modelMesh = null;
        
        // 交互变量
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.isDraggingView = false;
        this.mouseDownPos = new THREE.Vector2();
        this.dragControls = null;
        
        // 参数存储
        this.wireRadius = 0.4;
        this.markerRadius = 0.4;
        this.controlPointsCount = 10;
        this.smoothPointsCount = 50;
        this.PARAMS_STORAGE_KEY = 'dental_designer_params';
        
        // UI元素
        this.canvas = document.getElementById('mainCanvas');
        this.stlInput = document.getElementById('stl-input');
        this.jsonImport = document.getElementById('json-import');
        this.exportBtn = document.getElementById('export-json');
        this.opacitySlider = document.getElementById('opacity');
        this.statusEl = document.getElementById('status');
        this.openSettingsBtn = document.getElementById('open-settings');
        this.settingsModal = document.getElementById('settings-modal');
        this.cancelSettingsBtn = document.getElementById('cancel-settings');
        this.saveSettingsBtn = document.getElementById('save-settings');
        this.wireDiameterInput = document.getElementById('wire-diameter-input');
        this.markerDiameterInput = document.getElementById('marker-diameter-input');
        this.controlPointsInput = document.getElementById('control-points-input');
        this.smoothPointsInput = document.getElementById('smooth-points-input');
        
        // 回调函数（由其他模块设置）
        this.onModelLoaded = null;
        this.onWindowResize = null;
        this.onCanvasMouseDown = null;
        this.onCanvasMouseMove = null;
        this.onCanvasMouseUp = null;
        this.onUndo = null;
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0b1220);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, 0, 150);

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        const ambient = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambient);
        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(50, 60, 120);
        this.scene.add(dir);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = false;

        window.addEventListener('resize', () => this.handleWindowResize());

        // Canvas交互
        this.canvas.addEventListener('mousedown', (e) => this.handleCanvasMouseDown(e), true);
        this.canvas.addEventListener('mousemove', (e) => this.handleCanvasMouseMove(e), false);
        this.canvas.addEventListener('mouseup', (e) => this.handleCanvasMouseUp(e), false);
        window.addEventListener('keydown', (event) => {
            if (event.ctrlKey && (event.key === 'z' || event.key === 'Z')) {
                if (this.onUndo) this.onUndo();
            }
        });

        // 加载保存的参数
        this.loadParameters();

        this.animate();
    }

    handleWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        if (this.onWindowResize) this.onWindowResize();
    }

    handleCanvasMouseDown(event) {
        if (event.button !== 0) return;
        if (this.onCanvasMouseDown) this.onCanvasMouseDown(event);
        this.isDraggingView = false;
        this.mouseDownPos.set(event.clientX, event.clientY);
    }

    handleCanvasMouseMove(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        if (event.buttons !== 1) return;
        if (this.mouseDownPos.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) {
            this.isDraggingView = true;
        }
        if (this.onCanvasMouseMove) this.onCanvasMouseMove(event);
    }

    handleCanvasMouseUp(event) {
        if (event.button !== 0) return;
        if (this.isDraggingView) return;
        if (this.onCanvasMouseUp) this.onCanvasMouseUp(event);
    }

    loadSTLFile(file) {
        if (!file) return;
        const reader = new FileReader();
        this.setStatus('正在读取STL文件...');
        
        if (this.modelMesh) {
            this.scene.remove(this.modelMesh);
            this.modelMesh.geometry?.dispose?.();
            this.modelMesh.material?.dispose?.();
            this.modelMesh = null;
        }
        
        reader.onload = (e) => {
            try {
                const geometry = new STLLoader().parse(e.target.result);
                geometry.center();
                geometry.computeVertexNormals();
                const material = new THREE.MeshStandardMaterial({
                    color: 0xeaeaea,
                    metalness: 0.1,
                    roughness: 0.6,
                    transparent: true,
                    opacity: parseFloat(this.opacitySlider.value || '1')
                });
                this.modelMesh = new THREE.Mesh(geometry, material);
                this.modelMesh.rotation.x = -Math.PI / 2;
                this.scene.add(this.modelMesh);
                this.setStatus('STL模型加载完成');
                if (this.onModelLoaded) this.onModelLoaded();
            } catch (err) {
                console.error(err);
                this.setStatus('STL解析失败');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    importJSONFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target.result);
                if (Array.isArray(json.points)) {
                    this.setStatus('设计导入成功');
                    return json;
                } else {
                    this.setStatus('导入失败：JSON格式不正确');
                    return null;
                }
            } catch (err) {
                console.error(err);
                this.setStatus('导入失败：无效JSON');
                return null;
            }
        };
        reader.readAsText(file);
    }

    exportJSON(data) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        a.download = 'design.json';
        a.click();
        URL.revokeObjectURL(a.href);
    }

    setStatus(message) {
        this.statusEl.textContent = message || '';
    }

    // 参数管理
    loadParameters() {
        try {
            const saved = localStorage.getItem(this.PARAMS_STORAGE_KEY);
            if (saved) {
                const params = JSON.parse(saved);
                this.wireRadius = params.wireRadius || 0.4;
                this.markerRadius = params.markerRadius || 0.4;
                this.controlPointsCount = params.controlPointsCount || 10;
                this.smoothPointsCount = params.smoothPointsCount || 50;
            }
        } catch (err) {
            console.warn('Failed to load parameters:', err);
        }
    }

    saveParameters() {
        try {
            const params = {
                wireRadius: this.wireRadius,
                markerRadius: this.markerRadius,
                controlPointsCount: this.controlPointsCount,
                smoothPointsCount: this.smoothPointsCount
            };
            localStorage.setItem(this.PARAMS_STORAGE_KEY, JSON.stringify(params));
        } catch (err) {
            console.warn('Failed to save parameters:', err);
        }
    }

    showSettingsModal() {
        this.wireDiameterInput.value = (this.wireRadius * 2).toFixed(1);
        this.markerDiameterInput.value = (this.markerRadius * 2).toFixed(1);
        this.controlPointsInput.value = this.controlPointsCount;
        this.smoothPointsInput.value = this.smoothPointsCount;
        this.settingsModal.classList.remove('hidden');
    }

    hideSettingsModal() {
        this.settingsModal.classList.add('hidden');
    }

    saveSettings() {
        const newWireDiameter = parseFloat(this.wireDiameterInput.value);
        const newMarkerDiameter = parseFloat(this.markerDiameterInput.value);
        const newControlPoints = parseInt(this.controlPointsInput.value);
        const newSmoothPoints = parseInt(this.smoothPointsInput.value);

        if (!isNaN(newWireDiameter) && newWireDiameter > 0) this.wireRadius = newWireDiameter / 2;
        if (!isNaN(newMarkerDiameter) && newMarkerDiameter > 0) this.markerRadius = newMarkerDiameter / 2;
        if (!isNaN(newControlPoints) && newControlPoints >= 3 && newControlPoints <= 20) this.controlPointsCount = newControlPoints;
        if (!isNaN(newSmoothPoints) && newSmoothPoints >= 20 && newSmoothPoints <= 200) this.smoothPointsCount = newSmoothPoints;

        this.saveParameters();
        this.hideSettingsModal();
    }

    wireEvents() {
        this.stlInput.addEventListener('change', (e) => this.loadSTLFile(e.target.files?.[0]));
        this.jsonImport.addEventListener('change', (e) => this.importJSONFile(e.target.files?.[0]));
        this.opacitySlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (this.modelMesh && this.modelMesh.material) {
                this.modelMesh.material.opacity = value;
                this.modelMesh.material.transparent = value < 1;
            }
        });
        this.openSettingsBtn.addEventListener('click', () => this.showSettingsModal());
        this.cancelSettingsBtn.addEventListener('click', () => this.hideSettingsModal());
        this.saveSettingsBtn.addEventListener('click', () => this.saveSettings());
    }

    animate() {
        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(() => this.animate());
    }

    // 获取场景对象供其他模块使用
    getScene() { return this.scene; }
    getCamera() { return this.camera; }
    getRenderer() { return this.renderer; }
    getControls() { return this.controls; }
    getModelMesh() { return this.modelMesh; }
    getRaycaster() { return this.raycaster; }
    getMouse() { return this.mouse; }
    getIsDraggingView() { return this.isDraggingView; }
    getWireRadius() { return this.wireRadius; }
    getMarkerRadius() { return this.markerRadius; }
    getControlPointsCount() { return this.controlPointsCount; }
    getSmoothPointsCount() { return this.smoothPointsCount; }
}
