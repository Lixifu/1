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
let isContactPointsMode = false;

// Selection for U-loop
const SELECTION_COLOR_ULOOP = 0x9932CC;
const SELECTION_COLOR_ULOOP_MIDDLE = 0xFFA500; // 橙色用于中间点
let uLoopSelectionIndices = [];

// Contact points mode
let contactPoints = [];
let contactPointMarkers = [];
let selectedContactPoints = [];
const CONTACT_POINT_COLOR = 0x00FF00; // 绿色
const SELECTED_CONTACT_POINT_COLOR = 0xFF6600; // 橙色

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
// Removed U-loop parameters

// Geometry params (with defaults from design specs)
let wireRadius = 0.4; // mm (visual tube radius)
let markerRadius = 0.4; // mm (marker sphere radius)

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

// 计算参考平面与模型的接触点
function calculateContactPoints() {
	if (!modelMesh || !referencePlaneMesh) return;
	
	// 清除现有的接触点
	clearContactPoints();
	
	const geometry = modelMesh.geometry;
	const positionAttribute = geometry.getAttribute('position');
	const positions = positionAttribute.array;
	const indices = geometry.index ? geometry.index.array : null;
	
	// 获取参考平面的参数
	const planePosition = referencePlaneMesh.position;
	const planeNormal = new THREE.Vector3();
	referencePlaneMesh.getWorldDirection(planeNormal);
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
		vertex.applyMatrix4(modelMesh.matrixWorld);
		
		// 计算顶点到平面的距离
		const distance = Math.abs(plane.distanceToPoint(vertex));
		
		// 如果距离在容差范围内，认为是接触点
		if (distance <= tolerance) {
			candidatePoints.push(vertex.clone());
		}
	}
	
	// 对候选点进行聚类，避免重复点
	const clusteredPoints = clusterPoints(candidatePoints, 1.0); // 1mm聚类半径
	
	// 对接触点进行排序，按照在参考平面与模型交线上的实际位置排序
	const sortedPoints = sortContactPointsByIntersectionCurve(clusteredPoints, planePosition, planeNormal);
	
	// 创建接触点标记
	sortedPoints.forEach(point => {
		createContactPointMarker(point);
		contactPoints.push(point);
	});
	
	setStatus(`找到 ${contactPoints.length} 个接触点`);
}

// 按照角度对接触点进行排序
function sortContactPointsByAngle(points, planePosition, planeNormal) {
	// 创建平面内的两个正交向量
	const up = new THREE.Vector3(0, 1, 0);
	const right = new THREE.Vector3().crossVectors(planeNormal, up).normalize();
	const forward = new THREE.Vector3().crossVectors(right, planeNormal).normalize();
	
	// 计算每个点相对于平面中心的角度
	return points.sort((a, b) => {
		const aVec = new THREE.Vector3().subVectors(a, planePosition);
		const bVec = new THREE.Vector3().subVectors(b, planePosition);
		
		// 投影到平面内
		const aProj = new THREE.Vector3().addVectors(
			aVec.clone().projectOnVector(right).multiplyScalar(right.dot(aVec)),
			aVec.clone().projectOnVector(forward).multiplyScalar(forward.dot(aVec))
		);
		const bProj = new THREE.Vector3().addVectors(
			bVec.clone().projectOnVector(right).multiplyScalar(right.dot(bVec)),
			bVec.clone().projectOnVector(forward).multiplyScalar(forward.dot(bVec))
		);
		
		// 计算角度
		const aAngle = Math.atan2(aProj.dot(forward), aProj.dot(right));
		const bAngle = Math.atan2(bProj.dot(forward), bProj.dot(right));
		
		return aAngle - bAngle;
	});
}

// 按照在参考平面与模型交线上的实际位置对接触点进行排序
function sortContactPointsByIntersectionCurve(points, planePosition, planeNormal) {
	// 找到参考平面与模型的交线中心点
	const centerPoint = findIntersectionCurveCenter(points, planePosition, planeNormal);
	
	// 按照距离中心点的角度排序
	return points.sort((a, b) => {
		const aVec = new THREE.Vector3().subVectors(a, centerPoint);
		const bVec = new THREE.Vector3().subVectors(b, centerPoint);
		
		// 计算角度
		const aAngle = Math.atan2(aVec.z, aVec.x);
		const bAngle = Math.atan2(bVec.z, bVec.x);
		
		return aAngle - bAngle;
	});
}

// 找到参考平面与模型交线的中心点
function findIntersectionCurveCenter(points, planePosition, planeNormal) {
	if (points.length === 0) return planePosition;
	
	// 计算所有点的质心
	const center = new THREE.Vector3();
	points.forEach(point => center.add(point));
	center.divideScalar(points.length);
	
	return center;
}

// 点聚类函数
function clusterPoints(points, radius) {
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
function createContactPointMarker(position) {
	const geometry = new THREE.SphereGeometry(0.3, 16, 16);
	const material = new THREE.MeshBasicMaterial({ color: CONTACT_POINT_COLOR });
	const marker = new THREE.Mesh(geometry, material);
	marker.position.copy(position);
	marker.userData = { type: 'contactPoint', index: contactPoints.length };
	scene.add(marker);
	contactPointMarkers.push(marker);
}

// 清除接触点
function clearContactPoints() {
	contactPointMarkers.forEach(marker => scene.remove(marker));
	contactPointMarkers = [];
	contactPoints = [];
	selectedContactPoints = [];
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
		setStatus('编辑模式：拖动点修改路径。按住Shift单击选择三个端点。');
	}
	if (isContactPointsMode) {
		setStatus('接触点模式：单击接触点选择起点和终点。');
	}
	if (!isDrawingMode && !isEditMode && !isPlaneMode && !isContactPointsMode) {
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

function toggleContactPointsMode() {
	isContactPointsMode = !isContactPointsMode;
	if (isContactPointsMode) {
		isDrawingMode = false;
		isEditMode = false;
		// 计算并显示接触点
		calculateContactPoints();
	} else {
		// 清除接触点
		clearContactPoints();
	}
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
	// 清除接触点
	clearContactPoints();
	updateExportAvailability();
}

function addPointAtCursor() {
	if (!modelMesh) return;
	raycaster.setFromCamera(mouse, camera);
	const intersects = raycaster.intersectObject(modelMesh);
	if (intersects.length === 0) return;
	saveState();
	const offsetPoint = getOffsetPoint(intersects[0]);
	
	// 如果points数组为空，直接添加
	if (points.length === 0) {
		points.push(offsetPoint);
	} else {
		// 计算新点到路径两端点的距离
		const distanceToStart = offsetPoint.distanceTo(points[0]);
		const distanceToEnd = offsetPoint.distanceTo(points[points.length - 1]);
		
		// 根据距离决定插入位置
		if (distanceToStart <= distanceToEnd) {
			// 距离起点更近，插入到开头
			points.unshift(offsetPoint);
		} else {
			// 距离终点更近，插入到末尾
			points.push(offsetPoint);
		}
	}
	
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
	if (isContactPointsMode) {
		handleContactPointSelection();
	}
}

// Contact point selection and path generation
function handleContactPointSelection() {
	raycaster.setFromCamera(mouse, camera);
	const intersects = raycaster.intersectObjects(contactPointMarkers);
	if (intersects.length === 0) return;
	
	const marker = intersects[0].object;
	const index = marker.userData.index;
	
	// 如果已经选择了这个点，取消选择
	if (selectedContactPoints.includes(index)) {
		selectedContactPoints = selectedContactPoints.filter(i => i !== index);
		marker.material.color.set(CONTACT_POINT_COLOR);
		setStatus(`已取消选择接触点 ${index + 1}，当前选择：${selectedContactPoints.length}/2`);
		return;
	}
	
	// 如果已经选择了两个点，先清除选择
	if (selectedContactPoints.length >= 2) {
		selectedContactPoints.forEach(i => {
			contactPointMarkers[i].material.color.set(CONTACT_POINT_COLOR);
		});
		selectedContactPoints = [];
	}
	
	// 选择新点
	selectedContactPoints.push(index);
	marker.material.color.set(SELECTED_CONTACT_POINT_COLOR);
	
	setStatus(`已选择接触点 ${index + 1}，当前选择：${selectedContactPoints.length}/2`);
	
	// 如果选择了两个点，生成路径
	if (selectedContactPoints.length === 2) {
		generatePathFromContactPoints();
	}
}

function generatePathFromContactPoints() {
	if (selectedContactPoints.length !== 2) return;
	
	const startIndex = selectedContactPoints[0];
	const endIndex = selectedContactPoints[1];
	
	// 直接使用接触点，选择两点之间的短曲线
	const pathPoints = getCurvePointsBetweenIndices(contactPoints, startIndex, endIndex);
	
	if (pathPoints.length < 2) {
		setStatus('无法生成路径：未找到有效的接触点');
		return;
	}
	
	// 限制路径点数量在10个左右
	const limitedPoints = limitPathPoints(pathPoints, 10);
	
	// 清除现有路径并设置新路径
	saveState();
	points = limitedPoints;
	redrawScene();
	
	setStatus(`已生成包含 ${limitedPoints.length} 个点的平滑路径`);
}


function getCurvePointsBetweenIndices(contactPoints, startIndex, endIndex) {
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
	
	// 确保路径点按照在交线上的实际位置排序
	return sortPointsAlongCurve(selectedPoints);
}

// 沿着曲线对点进行排序
function sortPointsAlongCurve(points) {
	if (points.length <= 2) return points;
	
	// 计算曲线的总长度
	let totalLength = 0;
	for (let i = 1; i < points.length; i++) {
		totalLength += points[i-1].distanceTo(points[i]);
	}
	
	// 如果曲线太短，直接返回
	if (totalLength < 0.1) return points;
	
	// 按照累积距离排序
	const sortedPoints = [points[0]]; // 起点
	const remainingPoints = points.slice(1);
	
	while (remainingPoints.length > 0) {
		const lastPoint = sortedPoints[sortedPoints.length - 1];
		let closestIndex = 0;
		let minDistance = lastPoint.distanceTo(remainingPoints[0]);
		
		// 找到距离上一个点最近的点
		for (let i = 1; i < remainingPoints.length; i++) {
			const distance = lastPoint.distanceTo(remainingPoints[i]);
			if (distance < minDistance) {
				minDistance = distance;
				closestIndex = i;
			}
		}
		
		// 添加最近的点
		sortedPoints.push(remainingPoints[closestIndex]);
		remainingPoints.splice(closestIndex, 1);
	}
	
	return sortedPoints;
}

// 限制路径点数量
function limitPathPoints(points, maxPoints) {
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


// U-loop selection and generation
function handleULoopSelection(marker) {
	const index = marker.userData.index;
	const selectionIndex = uLoopSelectionIndices.indexOf(index);
	if (selectionIndex > -1) {
		uLoopSelectionIndices.splice(selectionIndex, 1);
		marker.material.color.set(0xff0000);
	} else {
		if (uLoopSelectionIndices.length >= 3) {
			// 如果已经选了三个点，先清除最早的点
			const oldIndex = uLoopSelectionIndices.shift();
			const oldMarker = draggableObjects.find(m => m.userData.index === oldIndex);
			if (oldMarker) oldMarker.material.color.set(0xff0000);
		}
		uLoopSelectionIndices.push(index);
		// 为不同位置的点设置不同颜色
		if (uLoopSelectionIndices.length === 3) {
			// 第一个点（起点）和最后一个点（终点）用紫色，中间点用橙色
			draggableObjects.forEach(m => {
				if (m.userData.index === uLoopSelectionIndices[0] || m.userData.index === uLoopSelectionIndices[2]) {
					m.material.color.set(SELECTION_COLOR_ULOOP);
				} else if (m.userData.index === uLoopSelectionIndices[1]) {
					m.material.color.set(SELECTION_COLOR_ULOOP_MIDDLE);
				}
			});
		} else {
			marker.material.color.set(SELECTION_COLOR_ULOOP);
		}
	}
	generateUloopBtn.disabled = uLoopSelectionIndices.length !== 3;
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
	if (uLoopSelectionIndices.length !== 3) return;
	saveState();
	// 保持三个点的顺序不变（起点、中间点、终点）
	const [index1, index2, index3] = uLoopSelectionIndices;
	const p_start = points[index1];
	const p_mid = points[index2]; // 这是U型曲的最低点
	const p_end = points[index3];

	// 根据三个点计算平面
	const newPoints = generateULoopFromThreePoints(p_start, p_mid, p_end);
	
	// 确定要替换的点范围
	const minIndex = Math.min(index1, index2, index3);
	const maxIndex = Math.max(index1, index2, index3);
	const pointsToRemove = maxIndex - minIndex - 1;
	points.splice(minIndex + 1, pointsToRemove, ...newPoints);
	deselectAllPoints();
	redrawScene();
}

function generateULoopGeometry(baseStart, baseEnd, y_hat, height) {
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
function generateULoopFromThreePoints(p_start, p_mid, p_end) {
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
	const newPoints = generateULoopGeometry(p_start, p_end, y_hat, height);
	
	return newPoints;
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
		}
	} catch (err) {
		console.warn('Failed to load parameters:', err);
	}
}

function saveParameters() {
	try {
		const params = {
			wireRadius,
			markerRadius
		};
		localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(params));
	} catch (err) {
		console.warn('Failed to save parameters:', err);
	}
}

function showSettingsModal() {
	wireDiameterInput.value = (wireRadius * 2).toFixed(1);
	markerDiameterInput.value = (markerRadius * 2).toFixed(1);
	settingsModal.classList.remove('hidden');
}

function hideSettingsModal() {
	settingsModal.classList.add('hidden');
}

function saveSettings() {
	const newWireDiameter = parseFloat(wireDiameterInput.value);
	const newMarkerDiameter = parseFloat(markerDiameterInput.value);

	if (!isNaN(newWireDiameter) && newWireDiameter > 0) wireRadius = newWireDiameter / 2;
	if (!isNaN(newMarkerDiameter) && newMarkerDiameter > 0) markerRadius = newMarkerDiameter / 2;

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
	designModeSelect.addEventListener('change', () => {
		const mode = designModeSelect.value;
		if (mode === 'contact-points') {
			toggleContactPointsMode();
		} else {
			if (isContactPointsMode) {
				toggleContactPointsMode(); // 退出接触点模式
			}
			updateArchCurve();
		}
	});
	toggleDrawBtn.addEventListener('click', () => toggleDrawMode());
	toggleEditBtn.addEventListener('click', () => toggleEditMode());
	clearAllBtn.addEventListener('click', () => { saveStateIfPoints(); clearDrawing(); });
	generateUloopBtn.addEventListener('click', () => generateULoopFromSelection());
	undoBtn.addEventListener('click', () => undo());
	openSettingsBtn.addEventListener('click', showSettingsModal);
	cancelSettingsBtn.addEventListener('click', hideSettingsModal);
	saveSettingsBtn.addEventListener('click', saveSettings);
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
