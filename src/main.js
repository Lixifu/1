import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DragControls } from 'three/addons/controls/DragControls.js';

let scene, camera, renderer, controls;
let modelMesh = null;
let points = [];
let archCurveObject = null;
let pointMarkers = [];
let draggableObjects = [];

// Plane setup
let planeControlPoints = [];
let referencePlaneMesh = null;
let planeNormal = new THREE.Vector3(0, 1, 0);
let planeDragControls = null;

// Modes
let isPlaneMode = false;
let isDrawingMode = false;
let isEditMode = false;

// UI Elements
const canvas = document.getElementById('mainCanvas');
const stlInput = document.getElementById('stl-input');
const jsonImport = document.getElementById('json-import');
const exportBtn = document.getElementById('export-json');
const opacitySlider = document.getElementById('opacity');
const statusEl = document.getElementById('status');
const planeStatusEl = document.getElementById('plane-status');
const enterPlaneBtn = document.getElementById('enter-plane-mode');
const confirmPlaneBtn = document.getElementById('confirm-plane');
const togglePlaneVisibilityBtn = document.getElementById('toggle-plane-visibility');
const designModeSelect = document.getElementById('design-mode');
const toggleDrawBtn = document.getElementById('toggle-draw');
const toggleEditBtn = document.getElementById('toggle-edit');
const clearAllBtn = document.getElementById('clear-all');

// Geometry params (basic for module two/three)
const wireRadius = 0.4; // mm (visual tube radius)
const markerRadius = 0.4; // mm (marker sphere radius)

// Interaction helpers
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let isDraggingView = false;
let mouseDownPos = new THREE.Vector2();
let dragControls = null;

function setStatus(message) {
	statusEl.textContent = message || '';
}

function initScene() {
	scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0b1220);

	camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
	camera.position.set(0, 0, 150);

	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(window.innerWidth, window.innerHeight);

	const ambient = new THREE.AmbientLight(0xffffff, 0.8);
	scene.add(ambient);
	const dir = new THREE.DirectionalLight(0xffffff, 1.2);
	dir.position.set(50, 60, 120);
	scene.add(dir);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = false;

	window.addEventListener('resize', onWindowResize);

	// Canvas interactions
	canvas.addEventListener('mousedown', onCanvasMouseDown, true);
	canvas.addEventListener('mousemove', onCanvasMouseMove, false);
	canvas.addEventListener('mouseup', onCanvasMouseUp, false);

	animate();
}

function onWindowResize() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
}

function loadSTLFile(file) {
	if (!file) return;
	const reader = new FileReader();
	setStatus('正在读取STL文件...');
	resetPlane();
	clearDrawing();
	if (modelMesh) {
		scene.remove(modelMesh);
		modelMesh.geometry?.dispose?.();
		modelMesh.material?.dispose?.();
		modelMesh = null;
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
				opacity: parseFloat(opacitySlider.value || '1')
			});
			modelMesh = new THREE.Mesh(geometry, material);
			modelMesh.rotation.x = -Math.PI / 2;
			scene.add(modelMesh);
			setStatus('STL模型加载完成');
			updateExportAvailability();
			enablePlaneUI();
			enterPlaneMode();
		} catch (err) {
			console.error(err);
			setStatus('STL解析失败');
		}
	};
	reader.readAsArrayBuffer(file);
}

function enablePlaneUI() {
	enterPlaneBtn.disabled = false;
	confirmPlaneBtn.disabled = true;
	togglePlaneVisibilityBtn.disabled = true;
	togglePlaneVisibilityBtn.textContent = '隐藏平面';
	planeStatusEl.textContent = '请在牙模上点击3个点来定义平面。';
}

function enterPlaneMode() {
	isPlaneMode = true;
	isDrawingMode = false;
	isEditMode = false;
	updateModeButtons();
	planeStatusEl.textContent = `请在牙模上点击 ${Math.max(0, 3 - planeControlPoints.length)} 个点来定义平面。`;
	// Hide path editing while in plane mode
	setMarkersVisibility(false);
	if (archCurveObject) archCurveObject.visible = false;
	setupPlaneDragControls();
}

function confirmPlane() {
	isPlaneMode = false;
	planeStatusEl.textContent = '参考平面已确认。';
	if (planeDragControls) {
		planeDragControls.dispose();
		planeDragControls = null;
	}
	setupPointDragControls();
	// Enable design UI
	disableDesignUI(false);
	if (archCurveObject) archCurveObject.visible = true;
	togglePlaneVisibilityBtn.disabled = false;
	setStatus('请选择操作模式。');
}

function togglePlaneVisibility() {
	if (!referencePlaneMesh) return;
	referencePlaneMesh.visible = !referencePlaneMesh.visible;
	togglePlaneVisibilityBtn.textContent = referencePlaneMesh.visible ? '隐藏平面' : '显示平面';
}

function addPlaneControlPoint(position) {
	if (planeControlPoints.length >= 3) return;
	const geometry = new THREE.SphereGeometry(0.4, 32, 32);
	const material = new THREE.MeshBasicMaterial({ color: 0x00FFFF });
	const point = new THREE.Mesh(geometry, material);
	point.position.copy(position);
	scene.add(point);
	planeControlPoints.push(point);
	planeStatusEl.textContent = `请在牙模上点击 ${Math.max(0, 3 - planeControlPoints.length)} 个点来定义平面。`;
	if (planeControlPoints.length === 3) {
		updateReferencePlane();
		confirmPlaneBtn.disabled = false;
		planeStatusEl.textContent = '平面已定义。可拖动控制点调整，或点击“确认平面”。';
	}
}

function setupPlaneDragControls() {
	if (planeDragControls) planeDragControls.dispose();
	planeDragControls = new DragControls(planeControlPoints, camera, renderer.domElement);
	planeDragControls.addEventListener('dragstart', () => { controls.enabled = false; });
	planeDragControls.addEventListener('drag', updateReferencePlane);
	planeDragControls.addEventListener('dragend', () => { controls.enabled = true; });
}

function updateReferencePlane() {
	if (planeControlPoints.length < 3) return;
	const [p1, p2, p3] = planeControlPoints.map(p => p.position);
	const plane = new THREE.Plane().setFromCoplanarPoints(p1, p2, p3);
	planeNormal.copy(plane.normal);
	if (!referencePlaneMesh) {
		const planeGeom = new THREE.PlaneGeometry(200, 200);
		const planeMat = new THREE.MeshStandardMaterial({ color: 0x00FFFF, opacity: 0.3, transparent: true, side: THREE.DoubleSide });
		referencePlaneMesh = new THREE.Mesh(planeGeom, planeMat);
		scene.add(referencePlaneMesh);
	}
	referencePlaneMesh.position.copy(p1);
	referencePlaneMesh.lookAt(p1.clone().add(plane.normal));
}

function resetPlane() {
	planeControlPoints.forEach(p => scene.remove(p));
	planeControlPoints = [];
	if (referencePlaneMesh) {
		scene.remove(referencePlaneMesh);
		referencePlaneMesh.geometry?.dispose?.();
		referencePlaneMesh.material?.dispose?.();
		referencePlaneMesh = null;
	}
	confirmPlaneBtn.disabled = true;
	togglePlaneVisibilityBtn.disabled = true;
}

// Path design (module three)
function disableDesignUI(disabled) {
	designModeSelect.disabled = disabled;
	toggleDrawBtn.disabled = disabled;
	toggleEditBtn.disabled = disabled;
	clearAllBtn.disabled = disabled;
}

function updateModeButtons() {
	// plane mode handled separately
	if (isDrawingMode) {
		toggleDrawBtn.textContent = '结束绘制';
		setStatus('绘制模式：单击牙模添加点。');
	} else {
		toggleDrawBtn.textContent = '开始绘制';
	}
	if (isEditMode) {
		setStatus('编辑模式：拖动点修改路径。');
	}
	if (!isDrawingMode && !isEditMode && !isPlaneMode) {
		setStatus('请选择操作模式。');
	}
}

function toggleDrawMode() {
	isDrawingMode = !isDrawingMode;
	if (isDrawingMode) isEditMode = false;
	updateModeButtons();
}

function toggleEditMode() {
	isEditMode = !isEditMode;
	if (isEditMode) isDrawingMode = false;
	updateModeButtons();
}

function clearDrawing() {
	points = [];
	pointMarkers.forEach(m => scene.remove(m));
	pointMarkers = [];
	draggableObjects = [];
	if (dragControls) {
		dragControls.dispose();
		dragControls = null;
	}
	if (archCurveObject) {
		scene.remove(archCurveObject);
		archCurveObject.geometry?.dispose?.();
		archCurveObject.material?.dispose?.();
		archCurveObject = null;
	}
	updateExportAvailability();
}

function addPointAtCursor() {
	if (!modelMesh) return;
	raycaster.setFromCamera(mouse, camera);
	const intersects = raycaster.intersectObject(modelMesh);
	if (intersects.length === 0) return;
	const offsetPoint = getOffsetPoint(intersects[0]);
	points.push(offsetPoint);
	redrawScene();
}

function getOffsetPoint(intersect) {
	const surfacePoint = intersect.point;
	const normalMatrix = new THREE.Matrix3().getNormalMatrix(intersect.object.matrixWorld);
	const worldNormal = intersect.face.normal.clone().applyMatrix3(normalMatrix).normalize();
	const offsetVector = worldNormal.multiplyScalar(wireRadius);
	return surfacePoint.clone().add(offsetVector);
}

function redrawScene() {
	// clean markers
	pointMarkers.forEach(m => scene.remove(m));
	pointMarkers = [];
	draggableObjects = [];
	points.forEach((p, i) => addPointMarker(p, i));
	updateArchCurve();
	setupPointDragControls();
	updateExportAvailability();
}

function addPointMarker(position, index) {
	const markerGeometry = new THREE.SphereGeometry(markerRadius, 16, 16);
	const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
	const marker = new THREE.Mesh(markerGeometry, markerMaterial);
	marker.position.copy(position);
	marker.userData = { index };
	scene.add(marker);
	pointMarkers.push(marker);
	draggableObjects.push(marker);
}

function setupPointDragControls() {
	if (dragControls) dragControls.dispose();
	dragControls = new DragControls(draggableObjects, camera, renderer.domElement);
	dragControls.addEventListener('dragstart', () => { controls.enabled = false; });
	dragControls.addEventListener('drag', (event) => {
		const idx = event.object.userData.index;
		if (typeof idx === 'number') {
			points[idx].copy(event.object.position);
			updateArchCurve();
		}
	});
	dragControls.addEventListener('dragend', () => { controls.enabled = true; });
}

function updateArchCurve() {
	if (archCurveObject) {
		scene.remove(archCurveObject);
		archCurveObject.geometry?.dispose?.();
		archCurveObject.material?.dispose?.();
		archCurveObject = null;
	}
	if (points.length < 2) return;
	const mode = designModeSelect.value;
	let curve;
	if (mode === 'smooth') {
		curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
	} else {
		const path = new THREE.CurvePath();
		for (let i = 0; i < points.length - 1; i++) {
			path.add(new THREE.LineCurve3(points[i], points[i + 1]));
		}
		curve = path;
	}
	const tubeGeometry = new THREE.TubeGeometry(curve, 256, wireRadius, 12, false);
	const tubeMaterial = new THREE.MeshStandardMaterial({ color: 0x00bfff, metalness: 0.5, roughness: 0.2, emissive: 0x112233 });
	archCurveObject = new THREE.Mesh(tubeGeometry, tubeMaterial);
	scene.add(archCurveObject);
}

function setMarkersVisibility(visible) {
	pointMarkers.forEach(m => m.visible = visible);
}

function updateExportAvailability() {
	exportBtn.disabled = points.length === 0;
}

function exportJSON() {
	if (points.length === 0) return;
	const data = { points: points.map(p => ({ x: p.x, y: p.y, z: p.z })) };
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
	a.download = 'design.json';
	a.click();
	URL.revokeObjectURL(a.href);
}

function importJSONFile(file) {
	if (!file) return;
	const reader = new FileReader();
	reader.onload = (e) => {
		try {
			const json = JSON.parse(e.target.result);
			if (Array.isArray(json.points)) {
				points = json.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
				setStatus('设计导入成功');
				redrawScene();
			} else {
				setStatus('导入失败：JSON格式不正确');
			}
		} catch (err) {
			console.error(err);
			setStatus('导入失败：无效JSON');
		}
	};
	reader.readAsText(file);
}

function onCanvasMouseDown(event) {
	if (event.button !== 0) return;
	isDraggingView = false;
	mouseDownPos.set(event.clientX, event.clientY);
}

function onCanvasMouseMove(event) {
	mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
	mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
	if (event.buttons !== 1) return;
	if (mouseDownPos.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) {
		isDraggingView = true;
	}
}

function onCanvasMouseUp(event) {
	if (event.button !== 0) return;
	if (isDraggingView) return;
	if (!modelMesh) return;
	if (isPlaneMode && planeControlPoints.length < 3) {
		raycaster.setFromCamera(mouse, camera);
		const intersects = raycaster.intersectObject(modelMesh);
		if (intersects.length > 0) addPlaneControlPoint(intersects[0].point);
		return;
	}
	if (isDrawingMode) {
		addPointAtCursor();
	}
}

function wireEvents() {
	stlInput.addEventListener('change', (e) => loadSTLFile(e.target.files?.[0]));
	jsonImport.addEventListener('change', (e) => importJSONFile(e.target.files?.[0]));
	exportBtn.addEventListener('click', exportJSON);
	opacitySlider.addEventListener('input', (e) => {
		const value = parseFloat(e.target.value);
		if (modelMesh && modelMesh.material) {
			modelMesh.material.opacity = value;
			modelMesh.material.transparent = value < 1;
		}
	});
	enterPlaneBtn.addEventListener('click', () => enterPlaneMode());
	confirmPlaneBtn.addEventListener('click', () => confirmPlane());
	togglePlaneVisibilityBtn.addEventListener('click', () => togglePlaneVisibility());
	designModeSelect.addEventListener('change', () => updateArchCurve());
	toggleDrawBtn.addEventListener('click', () => toggleDrawMode());
	toggleEditBtn.addEventListener('click', () => toggleEditMode());
	clearAllBtn.addEventListener('click', () => clearDrawing());
	// Design UI locked until plane confirmed
	disableDesignUI(true);
}

function animate() {
	restartIfContextLost();
	renderer.render(scene, camera);
	requestAnimationFrame(animate);
}

function restartIfContextLost() {
	// no-op placeholder, reserved for robustness on some browsers
}

initScene();
wireEvents();
