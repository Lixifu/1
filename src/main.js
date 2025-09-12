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

// Selection for U-loop
const SELECTION_COLOR_ULOOP = 0x9932CC;
let uLoopSelectionIndices = [];

// Undo history
let historyStack = [];

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
const generateUloopBtn = document.getElementById('generate-uloop');
const undoBtn = document.getElementById('undo');
const openSettingsBtn = document.getElementById('open-settings');
const settingsModal = document.getElementById('settings-modal');
const cancelSettingsBtn = document.getElementById('cancel-settings');
const saveSettingsBtn = document.getElementById('save-settings');
const wireDiameterInput = document.getElementById('wire-diameter-input');
const markerDiameterInput = document.getElementById('marker-diameter-input');
const uloopWidthInput = document.getElementById('uloop-width-input');
const uloopHeightInput = document.getElementById('uloop-height-input');
const uloopEndDistanceInput = document.getElementById('uloop-end-distance-input');
const aiSamplesInput = document.getElementById('ai-samples');
const aiGenerateBtn = document.getElementById('ai-generate');

// Geometry params (with defaults from design specs)
let wireRadius = 0.4; // mm (visual tube radius)
let markerRadius = 0.4; // mm (marker sphere radius)
let uLoopWidth = 4.0; // mm U-loop width
let uLoopHeight = 6.0; // mm U-loop height
let uLoopEndDistance = 1.0; // mm distance from tissue surface

// Parameter storage key
const PARAMS_STORAGE_KEY = 'dental_designer_params';

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
	window.addEventListener('keydown', (event) => {
		if (event.ctrlKey && (event.key === 'z' || event.key === 'Z')) {
			undo();
		}
	});

	// Load saved parameters
	loadParameters();

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
	saveStateIfPoints();
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
	generateUloopBtn.disabled = true;
	undoBtn.disabled = historyStack.length === 0;
	aiGenerateBtn.disabled = true;
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
		setStatus('编辑模式：拖动点修改路径。按住Shift单击选择两个端点。');
	}
	if (!isDrawingMode && !isEditMode && !isPlaneMode) {
		setStatus('请选择操作模式。');
	}
}

function toggleDrawMode() {
	isDrawingMode = !isDrawingMode;
	if (isDrawingMode) isEditMode = false;
	deselectAllPoints();
	updateModeButtons();
}

function toggleEditMode() {
	isEditMode = !isEditMode;
	if (isEditMode) isDrawingMode = false;
	updateModeButtons();
}

function clearDrawing() {
	deselectAllPoints();
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
	saveState();
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
	updateUndoBtn();
	updateAIAvailability();
}

function addPointMarker(position, index) {
	const isULoopInternal = position.userData && position.userData.isULoopInternal;
	const isSelected = uLoopSelectionIndices.includes(index);
	const markerGeometry = new THREE.SphereGeometry(markerRadius, 16, 16);
	const markerMaterial = new THREE.MeshBasicMaterial({ color: isSelected ? SELECTION_COLOR_ULOOP : 0xff0000 });
	const marker = new THREE.Mesh(markerGeometry, markerMaterial);
	marker.position.copy(position);
	marker.userData = { ...(position.userData || {}), index };
	scene.add(marker);
	pointMarkers.push(marker);
	if (!isULoopInternal) {
		draggableObjects.push(marker);
	} else {
		marker.visible = false;
	}
}

function setupPointDragControls() {
	if (dragControls) dragControls.dispose();
	dragControls = new DragControls(draggableObjects, camera, renderer.domElement);
	dragControls.addEventListener('dragstart', () => { controls.enabled = false; saveState(); });
	dragControls.addEventListener('drag', (event) => {
		const idx = event.object.userData.index;
		if (typeof idx === 'number') {
			points[idx].copy(event.object.position);
			updateArchCurve();
		}
	});
	dragControls.addEventListener('dragend', (event) => {
		controls.enabled = true;
		const idx = event.object.userData.index;
		if (uLoopSelectionIndices.includes(idx)) {
			event.object.material.color.set(SELECTION_COLOR_ULOOP);
		} else {
			event.object.material.color.set(0xff0000);
		}
	});
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
	// 无论选择什么模式，都使用CatmullRomCurve3来确保U型曲部分更加平滑
	curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
	// 增加TubeGeometry的分段数和径向分段数，使曲线更加平滑和圆润
	const tubeGeometry = new THREE.TubeGeometry(curve, 512, wireRadius, 16, false);
	const tubeMaterial = new THREE.MeshStandardMaterial({ color: 0x00bfff, metalness: 0.5, roughness: 0.2, emissive: 0x112233 });
	archCurveObject = new THREE.Mesh(tubeGeometry, tubeMaterial);
	scene.add(archCurveObject);
}

function setMarkersVisibility(visible) {
	pointMarkers.forEach(m => m.visible = visible && !(m.userData && m.userData.isULoopInternal));
}

function updateExportAvailability() {
	exportBtn.disabled = points.length === 0;
}

function updateAIAvailability() {
	const hasPlane = planeControlPoints.length === 3 || !!referencePlaneMesh;
	aiGenerateBtn.disabled = !(modelMesh && hasPlane && points.length >= 3);
	if (!aiSamplesInput.value) aiSamplesInput.value = 200;
}

function updateUndoBtn() {
	undoBtn.disabled = historyStack.length === 0;
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
				saveStateIfPoints();
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
	// Selection in edit mode with Shift
	if (isEditMode && event.shiftKey) {
		raycaster.setFromCamera(mouse, camera);
		const intersects = raycaster.intersectObjects(draggableObjects);
		if (intersects.length > 0) {
			handleULoopSelection(intersects[0].object);
		} else {
			deselectAllPoints();
		}
		event.stopImmediatePropagation();
		return;
	}
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

// U-loop selection and generation
function handleULoopSelection(marker) {
	const index = marker.userData.index;
	const selectionIndex = uLoopSelectionIndices.indexOf(index);
	if (selectionIndex > -1) {
		uLoopSelectionIndices.splice(selectionIndex, 1);
		marker.material.color.set(0xff0000);
	} else {
		if (uLoopSelectionIndices.length >= 2) {
			const oldIndex = uLoopSelectionIndices.shift();
			const oldMarker = draggableObjects.find(m => m.userData.index === oldIndex);
			if (oldMarker) oldMarker.material.color.set(0xff0000);
		}
		uLoopSelectionIndices.push(index);
		marker.material.color.set(SELECTION_COLOR_ULOOP);
	}
	generateUloopBtn.disabled = uLoopSelectionIndices.length !== 2;
}

function deselectAllPoints() {
	uLoopSelectionIndices.forEach(i => {
		const marker = draggableObjects.find(m => m.userData.index === i);
		if (marker) marker.material.color.set(0xff0000);
	});
	uLoopSelectionIndices = [];
	generateUloopBtn.disabled = true;
}

function generateULoopFromSelection() {
	if (uLoopSelectionIndices.length !== 2) return;
	saveState();
	const [index1, index2] = uLoopSelectionIndices.slice().sort((a, b) => a - b);
	const p_start = points[index1];
	const p_end = points[index2];
	const hasMiddle = (index2 - index1 > 1);
	const p_mid_ref = hasMiddle ? points[Math.floor((index1 + index2) / 2)] : null;

	const x_hat = new THREE.Vector3().subVectors(p_end, p_start).normalize();
	let y_hat;
	if (p_mid_ref) {
		const v1m = new THREE.Vector3().subVectors(p_mid_ref, p_start);
		const v_perp = v1m.clone().sub(x_hat.clone().multiplyScalar(v1m.dot(x_hat)));
		y_hat = (v_perp.lengthSq() < 1e-6) ? new THREE.Vector3().crossVectors(x_hat, planeNormal).normalize() : v_perp.normalize();
		const curveMidpoint = p_start.clone().lerp(p_end, 0.5);
		const outVector = new THREE.Vector3().subVectors(p_mid_ref, curveMidpoint);
		if (y_hat.dot(outVector) < 0) y_hat.negate();
	} else {
		y_hat = new THREE.Vector3().crossVectors(x_hat, planeNormal).normalize();
	}

	const newPoints = generateULoopGeometry(p_start, p_end, y_hat, uLoopHeight);
	const pointsToRemove = index2 - index1 - 1;
	points.splice(index1 + 1, pointsToRemove, ...newPoints);
	deselectAllPoints();
	redrawScene();
}

function generateULoopGeometry(baseStart, baseEnd, y_hat, height) {
	// 不添加额外的宽度偏移，直接使用原始端点作为U型曲的基础
	// Add height to arms
	const armTopStart = baseStart.clone().add(y_hat.clone().multiplyScalar(height));
	const armTopEnd = baseEnd.clone().add(y_hat.clone().multiplyScalar(height));
	
	// Apply end distance offset (move away from tissue surface)
	const endOffset = y_hat.clone().multiplyScalar(uLoopEndDistance);
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

// Undo stack
function saveState() {
	const state = {
		points: points.map(p => {
			const np = p.clone();
			if (p.userData) np.userData = { ...p.userData };
			return np;
		})
	};
	historyStack.push(state);
	updateUndoBtn();
}

function saveStateIfPoints() {
	if (points.length > 0) saveState();
}

function undo() {
	if (historyStack.length === 0) return;
	const prev = historyStack.pop();
	points = prev.points.map(p => {
		const np = p.clone();
		if (p.userData) np.userData = { ...p.userData };
		return np;
	});
	undoBtn.disabled = historyStack.length === 0;
	deselectAllPoints();
	redrawScene();
}

// Parameter management
function loadParameters() {
	try {
		const saved = localStorage.getItem(PARAMS_STORAGE_KEY);
		if (saved) {
			const params = JSON.parse(saved);
			wireRadius = params.wireRadius || 0.4;
			markerRadius = params.markerRadius || 0.4;
			uLoopWidth = params.uLoopWidth || 4.0;
			uLoopHeight = params.uLoopHeight || 6.0;
			uLoopEndDistance = params.uLoopEndDistance || 1.0;
		}
	} catch (err) {
		console.warn('Failed to load parameters:', err);
	}
}

function saveParameters() {
	try {
		const params = {
			wireRadius,
			markerRadius,
			uLoopWidth,
			uLoopHeight,
			uLoopEndDistance
		};
		localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(params));
	} catch (err) {
		console.warn('Failed to save parameters:', err);
	}
}

function showSettingsModal() {
	wireDiameterInput.value = (wireRadius * 2).toFixed(1);
	markerDiameterInput.value = (markerRadius * 2).toFixed(1);
	uloopWidthInput.value = uLoopWidth;
	uloopHeightInput.value = uLoopHeight;
	uloopEndDistanceInput.value = uLoopEndDistance;
	settingsModal.classList.remove('hidden');
}

function hideSettingsModal() {
	settingsModal.classList.add('hidden');
}

function saveSettings() {
	const newWireDiameter = parseFloat(wireDiameterInput.value);
	const newMarkerDiameter = parseFloat(markerDiameterInput.value);
	const newULoopWidth = parseFloat(uloopWidthInput.value);
	const newULoopHeight = parseFloat(uloopHeightInput.value);
	const newULoopEndDistance = parseFloat(uloopEndDistanceInput.value);

	if (!isNaN(newWireDiameter) && newWireDiameter > 0) wireRadius = newWireDiameter / 2;
	if (!isNaN(newMarkerDiameter) && newMarkerDiameter > 0) markerRadius = newMarkerDiameter / 2;
	if (!isNaN(newULoopWidth) && newULoopWidth > 0) uLoopWidth = newULoopWidth;
	if (!isNaN(newULoopHeight) && newULoopHeight > 0) uLoopHeight = newULoopHeight;
	if (!isNaN(newULoopEndDistance) && newULoopEndDistance > 0) uLoopEndDistance = newULoopEndDistance;

	saveParameters();
	redrawScene();
	hideSettingsModal();
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
	clearAllBtn.addEventListener('click', () => { saveStateIfPoints(); clearDrawing(); });
	generateUloopBtn.addEventListener('click', () => generateULoopFromSelection());
	undoBtn.addEventListener('click', () => undo());
	openSettingsBtn.addEventListener('click', showSettingsModal);
	cancelSettingsBtn.addEventListener('click', hideSettingsModal);
	saveSettingsBtn.addEventListener('click', saveSettings);
	aiGenerateBtn.addEventListener('click', () => aiGeneratePath());
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

// --- AI-assisted path generation (heuristic based on reference plane) ---
function aiGeneratePath() {
	if (!modelMesh) { setStatus('请先加载STL模型。'); return; }
	if (planeControlPoints.length < 3 && !referencePlaneMesh) { setStatus('请先定义并确认参考平面。'); return; }
	if (points.length < 3) { setStatus('请至少放置3个关键点。'); return; }
	const sampleCount = clampInt(parseInt(aiSamplesInput.value, 10), 50, 600);
	const planePoint = (planeControlPoints[0] ? planeControlPoints[0].position : new THREE.Vector3(0,0,0)).clone();
	const n = planeNormal.clone().normalize();
	const basis = buildPlaneBasis(n);

	// 1) Project key points to plane and 2D coordinates
	const key2D = points.map(p => {
		const proj = projectPointToPlane(p, planePoint, n);
		return toPlane2D(proj, planePoint, basis.u, basis.v);
	});
	// 2) Fit Catmull-Rom in 2D and sample
	const curve2D = new THREE.CatmullRomCurve3(key2D.map(pt => new THREE.Vector3(pt.x, pt.y, 0)), false, 'catmullrom', 0.5);
	const newPoints = [];
	for (let i = 0; i < sampleCount; i++) {
		const t = i / (sampleCount - 1);
		const p2 = curve2D.getPoint(t);
		const p3 = fromPlane2D({ x: p2.x, y: p2.y }, planePoint, basis.u, basis.v);
		// 3) Cast along plane normal to find surface, then offset by wire radius
		const hit = raycastAlongNormal(p3, n);
		if (hit) {
			const offset = getOffsetPoint(hit);
			newPoints.push(offset);
		} else {
			// fallback to plane point (with outward offset) if no hit
			newPoints.push(p3.clone().add(n.clone().multiplyScalar(wireRadius)));
		}
	}
	// apply
	saveState();
	points = newPoints;
	redrawScene();
	setStatus(`AI生成完成（${sampleCount} 点）。`);
}

function projectPointToPlane(p, planePoint, normal) {
	const v = new THREE.Vector3().subVectors(p, planePoint);
	const dist = v.dot(normal);
	return p.clone().sub(normal.clone().multiplyScalar(dist));
}

function buildPlaneBasis(normal) {
	// choose arbitrary vector not parallel to normal
	const arbitrary = Math.abs(normal.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
	const u = new THREE.Vector3().crossVectors(normal, arbitrary).normalize();
	const v = new THREE.Vector3().crossVectors(normal, u).normalize();
	return { u, v };
}

function toPlane2D(p, planePoint, u, v) {
	const rel = new THREE.Vector3().subVectors(p, planePoint);
	return { x: rel.dot(u), y: rel.dot(v) };
}

function fromPlane2D(pt, planePoint, u, v) {
	return planePoint.clone().add(u.clone().multiplyScalar(pt.x)).add(v.clone().multiplyScalar(pt.y));
}

function raycastAlongNormal(pointOnPlane, normal) {
	const origin = pointOnPlane.clone().add(normal.clone().multiplyScalar(200));
	const dir = normal.clone().negate();
	raycaster.set(origin, dir);
	const intersects = raycaster.intersectObject(modelMesh);
	return intersects.length > 0 ? intersects[0] : null;
}

function clampInt(val, min, max) {
	if (isNaN(val)) return min;
	return Math.min(max, Math.max(min, val|0));
}
