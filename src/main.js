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
let isHyperbolaMode = false; // 已废弃，不再从UI进入
let isParabolaMode = false;

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

// Hyperbola mode state (kept for backward compatibility, not used by UI)
let hyperbolaSelectedContactPoints = [];
let hyperbolaShortCurvePoints = [];
let hyperbolaGuideLine = null;
const HYPERBOLA_SAMPLE_COLOR = 0x00BFFF; // 已不再使用手动采样标记，保留颜色常量

// Parabola mode state
let parabolaPickedPoints = [];
let parabolaMarkers = [];
const PARABOLA_MARKER_COLOR = 0x00BFFF;

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
const controlPointsInput = document.getElementById('control-points-input');
const smoothPointsInput = document.getElementById('smooth-points-input');
// Removed U-loop parameters

// Geometry params (with defaults from design specs)
let wireRadius = 0.4; // mm (visual tube radius)
let markerRadius = 0.4; // mm (marker sphere radius)
let controlPointsCount = 10; // 控制点数量
let smoothPointsCount = 50; // 平滑曲线点数

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
	
	// 对接触点进行排序，使用TSP最短路径算法
	const sortedPoints = sortContactPointsByTSP(clusteredPoints);
	
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

// 使用TSP最短路径算法对接触点进行排序
function sortContactPointsByTSP(points) {
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
	if (isParabolaMode) {
		setStatus('抛物线模式：在牙模上点击选择3个点进行拟合。');
	}
	if (!isDrawingMode && !isEditMode && !isPlaneMode && !isContactPointsMode && !isHyperbolaMode) {
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

function enterHyperbolaMode() {
	isHyperbolaMode = true;
	isDrawingMode = false;
	isEditMode = false;
	// 进入前清理上一次状态
	clearHyperbolaWorkingState();
	// 复用接触点检测与显示
	calculateContactPoints();
	updateModeButtons();
}

function exitHyperbolaMode() {
	isHyperbolaMode = false;
	clearHyperbolaWorkingState();
	clearContactPoints();
	updateModeButtons();
}

function enterParabolaMode() {
	isParabolaMode = true;
	isDrawingMode = false;
	isEditMode = false;
	// 清理旧状态
	clearParabolaWorkingState();
	updateModeButtons();
}

function exitParabolaMode() {
	isParabolaMode = false;
	clearParabolaWorkingState();
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
	// 清除双曲线工作态
	clearHyperbolaWorkingState();
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
	
	// 构建导出数据，包含路径点和参考平面信息
	const data = { 
		points: points.map(p => ({ x: p.x, y: p.y, z: p.z })),
		referencePlane: null
	};
	
	// 如果有参考平面，添加参考平面数据
	if (referencePlaneMesh && planeControlPoints.length === 3) {
		data.referencePlane = {
			controlPoints: planeControlPoints.map(p => ({ 
				x: p.position.x, 
				y: p.position.y, 
				z: p.position.z 
			})),
			normal: {
				x: planeNormal.x,
				y: planeNormal.y,
				z: planeNormal.z
			},
			position: {
				x: referencePlaneMesh.position.x,
				y: referencePlaneMesh.position.y,
				z: referencePlaneMesh.position.z
			},
			visible: referencePlaneMesh.visible
		};
	}
	
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
				
				// 导入参考平面数据
				if (json.referencePlane && Array.isArray(json.referencePlane.controlPoints) && json.referencePlane.controlPoints.length === 3) {
					// 清除现有参考平面
					resetPlane();
					
					// 恢复控制点
					json.referencePlane.controlPoints.forEach(pointData => {
						const position = new THREE.Vector3(pointData.x, pointData.y, pointData.z);
						addPlaneControlPoint(position);
					});
					
					// 恢复平面法线
					if (json.referencePlane.normal) {
						planeNormal.set(json.referencePlane.normal.x, json.referencePlane.normal.y, json.referencePlane.normal.z);
					}
					
					// 确认平面状态（这会创建referencePlaneMesh）
					confirmPlane();
					
					// 恢复平面位置和可见性
					if (referencePlaneMesh && json.referencePlane.position) {
						referencePlaneMesh.position.set(
							json.referencePlane.position.x, 
							json.referencePlane.position.y, 
							json.referencePlane.position.z
						);
					}
					
					if (referencePlaneMesh && typeof json.referencePlane.visible === 'boolean') {
						referencePlaneMesh.visible = json.referencePlane.visible;
						togglePlaneVisibilityBtn.textContent = referencePlaneMesh.visible ? '隐藏平面' : '显示平面';
					}
					
					setStatus('设计和参考平面导入成功');
				} else {
					setStatus('设计导入成功');
				}
				
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
	if (isHyperbolaMode) {
		handleHyperbolaMouseUp();
	}
	if (isParabolaMode) {
		handleParabolaMouseUp();
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

// Hyperbola mode interactions
function handleHyperbolaMouseUp() {
	raycaster.setFromCamera(mouse, camera);
	// 阶段1：选择两个接触点
	if (hyperbolaSelectedContactPoints.length < 2) {
		const intersects = raycaster.intersectObjects(contactPointMarkers);
		if (intersects.length === 0) return;
		const marker = intersects[0].object;
		const index = marker.userData.index;
		// 切换选择
		const exists = hyperbolaSelectedContactPoints.includes(index);
		if (exists) {
			hyperbolaSelectedContactPoints = hyperbolaSelectedContactPoints.filter(i => i !== index);
			marker.material.color.set(CONTACT_POINT_COLOR);
			setStatus(`双曲线：已取消接触点 ${index + 1}，当前选择：${hyperbolaSelectedContactPoints.length}/2`);
			return;
		}
		if (hyperbolaSelectedContactPoints.length >= 2) {
			resetHyperbolaContactSelectionColors();
			hyperbolaSelectedContactPoints = [];
		}
		hyperbolaSelectedContactPoints.push(index);
		marker.material.color.set(SELECTED_CONTACT_POINT_COLOR);
		setStatus(`双曲线：已选择接触点 ${index + 1}，当前选择：${hyperbolaSelectedContactPoints.length}/2`);
		if (hyperbolaSelectedContactPoints.length === 2) {
			prepareHyperbolaShortCurve();
			generateHyperbolaPath();
		}
	}
}

function clearHyperbolaWorkingState() {
	resetHyperbolaContactSelectionColors();
	hyperbolaSelectedContactPoints = [];
	hyperbolaShortCurvePoints = [];
	if (hyperbolaGuideLine) {
		scene.remove(hyperbolaGuideLine);
		hyperbolaGuideLine.geometry?.dispose?.();
		hyperbolaGuideLine.material?.dispose?.();
		hyperbolaGuideLine = null;
	}
}

function clearParabolaWorkingState() {
	parabolaPickedPoints = [];
	parabolaMarkers.forEach(m => { scene.remove(m); });
	parabolaMarkers = [];
}

function resetHyperbolaContactSelectionColors() {
	if (!contactPointMarkers.length) return;
	contactPointMarkers.forEach(m => m.material.color.set(CONTACT_POINT_COLOR));
}

function prepareHyperbolaShortCurve() {
	const startIndex = hyperbolaSelectedContactPoints[0];
	const endIndex = hyperbolaSelectedContactPoints[1];
	const pathPoints = getCurvePointsBetweenIndices(contactPoints, startIndex, endIndex);
	hyperbolaShortCurvePoints = pathPoints.map(p => p.clone());
	// 显示引导线
	if (hyperbolaGuideLine) {
		scene.remove(hyperbolaGuideLine);
		hyperbolaGuideLine.geometry?.dispose?.();
		hyperbolaGuideLine.material?.dispose?.();
		hyperbolaGuideLine = null;
	}
	const g = new THREE.BufferGeometry().setFromPoints(hyperbolaShortCurvePoints);
	const m = new THREE.LineBasicMaterial({ color: 0x00aaff });
	hyperbolaGuideLine = new THREE.Line(g, m);
	scene.add(hyperbolaGuideLine);
}

function generateHyperbolaPath() {
	if (hyperbolaSelectedContactPoints.length !== 2 || hyperbolaShortCurvePoints.length < 2) return;
	// 自动从短曲线上选取3个中间采样点（按弧长25%、50%、75%）
	const autoMid = pickAutoThreeSamples(hyperbolaShortCurvePoints);
	// 构造用于拟合的平面：用端点和中间点近似最佳平面
	const plane = estimateBestFitPlane([hyperbolaShortCurvePoints[0], ...autoMid, hyperbolaShortCurvePoints[hyperbolaShortCurvePoints.length - 1]]);
	const basis = buildPlaneBasis(plane.normal);
	const centroid = plane.point;
	const end1 = toPlane2D(hyperbolaShortCurvePoints[0], centroid, basis.u, basis.v);
	const end2 = toPlane2D(hyperbolaShortCurvePoints[hyperbolaShortCurvePoints.length - 1], centroid, basis.u, basis.v);
	const mids2 = autoMid.map(p => toPlane2D(p, centroid, basis.u, basis.v));
	// 约束拟合：必须通过两个端点；最小二乘拟合中间三个
	const conic = fitConicConstrainedThrough(end1, end2, mids2);
	let generated2D = [];
	if (conic && isHyperbolaConic(conic)) {
		generated2D = sampleHyperbolaConicConstrained(conic, end1, end2, mids2, smoothPointsCount);
	} else {
		// 退化：用短曲线的点进行平滑插值
		const crv = new THREE.CatmullRomCurve3(hyperbolaShortCurvePoints, false, 'catmullrom', 0.5);
		const arr = crv.getPoints(smoothPointsCount);
		saveState();
		points = arr;
		redrawScene();
		setStatus('双曲线拟合失败，已使用平滑曲线替代。');
		return;
	}
	// 映射回3D
	const generated3D = generated2D.map(p2 => fromPlane2D(p2, centroid, basis.u, basis.v));
	saveState();
	points = generated3D;
	redrawScene();
	setStatus('双曲线路径已生成（通过两端点，拟合中间三点）。');
	// 退出/清理工作态但保留模式方便再次生成
	clearHyperbolaWorkingState();
}

// Parabola mode interactions
function handleParabolaMouseUp() {
	raycaster.setFromCamera(mouse, camera);
	const intersects = raycaster.intersectObject(modelMesh);
	if (intersects.length === 0) return;
	const p = getOffsetPoint(intersects[0]);
	addParabolaMarker(p);
	parabolaPickedPoints.push(p.clone());
	setStatus(`抛物线：已选择 ${parabolaPickedPoints.length}/3 个点`);
	if (parabolaPickedPoints.length === 3) {
		generateParabolaPath(parabolaPickedPoints[0], parabolaPickedPoints[1], parabolaPickedPoints[2]);
		clearParabolaWorkingState();
		setStatus('抛物线路径已生成。');
	}
}

function addParabolaMarker(p) {
	const geom = new THREE.SphereGeometry(0.35, 16, 16);
	const mat = new THREE.MeshBasicMaterial({ color: PARABOLA_MARKER_COLOR });
	const marker = new THREE.Mesh(geom, mat);
	marker.position.copy(p);
	scene.add(marker);
	parabolaMarkers.push(marker);
}

function generateParabolaPath(p1, p2, p3) {
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
	function to2D(p) { const d = new THREE.Vector3().subVectors(p, origin); return { x: d.dot(u), y: d.dot(v) }; }
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
	const coeff = solve3x3(aMat, yVec);
	if (!coeff) {
		// 退化回CatmullRom通过三点
		const crv = new THREE.CatmullRomCurve3([p1, p2, p3], false, 'catmullrom', 0.5);
		const arr = crv.getPoints(smoothPointsCount);
		saveState(); points = arr; redrawScene();
		return;
	}
	const [a, b, c] = coeff;
	// 采样x从0到P3.x方向，保持与p1->p3一致的方向
	const xStart = 0;
	const xEnd = P3.x;
	const samples = [];
	for (let i = 0; i < smoothPointsCount; i++) {
		const t = i / (smoothPointsCount - 1);
		const x = xStart + (xEnd - xStart) * t;
		const y = a * x * x + b * x + c;
		samples.push({ x, y });
	}
	// 映射回3D
	const result3D = samples.map(p => origin.clone().add(u.clone().multiplyScalar(p.x)).add(v.clone().multiplyScalar(p.y)));
	saveState();
	points = result3D;
	redrawScene();
}

function solve3x3(A, b) {
	// 解 Ax=b，直接求逆或克拉默法则
	const m = A;
	const d = det3(m);
	if (Math.abs(d) < 1e-9) return null;
	const inv = inv3(m);
	if (!inv) return null;
	const x = [
		inv[0][0] * b[0] + inv[0][1] * b[1] + inv[0][2] * b[2],
		inv[1][0] * b[0] + inv[1][1] * b[1] + inv[1][2] * b[2],
		inv[2][0] * b[0] + inv[2][1] * b[1] + inv[2][2] * b[2]
	];
	return x;
}

function det3(m) {
	return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
}

function inv3(m) {
	const d = det3(m);
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

// Utility: estimate plane, basis, projections
function estimateBestFitPlane(pts) {
	// 质心
	const c = new THREE.Vector3();
	pts.forEach(p => c.add(p));
	c.divideScalar(pts.length);
	// 协方差矩阵
	let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
	for (const p of pts) {
		const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
		xx += dx * dx; xy += dx * dy; xz += dx * dz;
		yy += dy * dy; yz += dy * dz; zz += dz * dz;
	}
	const cov = [
		[xx, xy, xz],
		[xy, yy, yz],
		[xz, yz, zz]
	];
	const normal = smallestEigenVector3(cov);
	return { point: c, normal };
}

function buildPlaneBasis(normal) {
	const n = normal.clone().normalize();
	const tmp = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
	const u = new THREE.Vector3().crossVectors(tmp, n).normalize();
	const v = new THREE.Vector3().crossVectors(n, u).normalize();
	return { u, v, n };
}

function toPlane2D(p, origin, u, v) {
	const d = new THREE.Vector3().subVectors(p, origin);
	return { x: d.dot(u), y: d.dot(v) };
}

function fromPlane2D(p2, origin, u, v) {
	return new THREE.Vector3().copy(origin).add(u.clone().multiplyScalar(p2.x)).add(v.clone().multiplyScalar(p2.y));
}

function intersectRayWithPlaneOfPoints(pts) {
	if (pts.length < 3) return null;
	const plane = estimateBestFitPlane(pts);
	const n = plane.normal.clone().normalize();
	const p0 = plane.point.clone();
	raycaster.setFromCamera(mouse, camera);
	const rOrigin = raycaster.ray.origin.clone();
	const rDir = raycaster.ray.direction.clone();
	const denom = n.dot(rDir);
	if (Math.abs(denom) < 1e-6) return null;
	const t = n.dot(p0.clone().sub(rOrigin)) / denom;
	if (t < 0) return null;
	return rOrigin.add(rDir.multiplyScalar(t));
}

function projectPointToPolyline(p, poly) {
	if (poly.length < 2) return null;
	let best = null;
	let bestDist2 = Infinity;
	for (let i = 0; i < poly.length - 1; i++) {
		const a = poly[i];
		const b = poly[i + 1];
		const ab = new THREE.Vector3().subVectors(b, a);
		const ap = new THREE.Vector3().subVectors(p, a);
		const t = Math.max(0, Math.min(1, ap.dot(ab) / ab.lengthSq()));
		const q = a.clone().add(ab.multiplyScalar(t));
		const d2 = q.distanceToSquared(p);
		if (d2 < bestDist2) { bestDist2 = d2; best = q; }
	}
	return best;
}

function smallestEigenVector3(m) {
	// Power iteration on inverse via Jacobi for 3x3 symmetric matrix
	// Using simple Jacobi eigenvalue algorithm
	let a11 = m[0][0], a12 = m[0][1], a13 = m[0][2];
	let a22 = m[1][1], a23 = m[1][2];
	let a33 = m[2][2];
	let v = [1, 0, 0], w = [0, 1, 0], u = [0, 0, 1];
	function rotate(p, q, angle) {
		const c = Math.cos(angle), s = Math.sin(angle);
		for (const vec of [v, w, u]) {
			const ip = vec[p], iq = vec[q];
			vec[p] = c * ip - s * iq;
			vec[q] = s * ip + c * iq;
		}
	}
	for (let k = 0; k < 10; k++) {
		// find largest off-diagonal
		let p = 0, q = 1, max = Math.abs(a12);
		if (Math.abs(a13) > max) { max = Math.abs(a13); p = 0; q = 2; }
		if (Math.abs(a23) > max) { max = Math.abs(a23); p = 1; q = 2; }
		if (max < 1e-9) break;
		let app, aqq, apq;
		if (p === 0 && q === 1) { app = a11; aqq = a22; apq = a12; }
		if (p === 0 && q === 2) { app = a11; aqq = a33; apq = a13; }
		if (p === 1 && q === 2) { app = a22; aqq = a33; apq = a23; }
		const phi = 0.5 * Math.atan2(2 * apq, (aqq - app));
		rotate(p, q, phi);
		// Update matrix entries approximately (not needed for final eigenvector direction quality)
		const c = Math.cos(phi), s = Math.sin(phi);
		function rot(a, b, cval, sval) { const t = cval * a - sval * b; return { x: t, y: sval * a + cval * b }; }
		if (p === 0 && q === 1) {
			const r1 = rot(a11, a12, c, s); const r2 = rot(a12, a22, c, s);
			a11 = r1.x; a12 = r1.y; a22 = r2.y;
			const r13 = rot(a13, a23, c, s); a13 = r13.x; a23 = r13.y;
		}
		if (p === 0 && q === 2) {
			const r1 = rot(a11, a13, c, s); const r2 = rot(a13, a33, c, s);
			a11 = r1.x; a13 = r1.y; a33 = r2.y;
			const r12 = rot(a12, a23, c, s); a12 = r12.x; a23 = r12.y;
		}
		if (p === 1 && q === 2) {
			const r1 = rot(a22, a23, c, s); const r2 = rot(a23, a33, c, s);
			a22 = r1.x; a23 = r1.y; a33 = r2.y;
			const r12 = rot(a12, a13, c, s); a12 = r12.x; a13 = r12.y;
		}
	}
	// Smallest eigenvector approximated as the column with smallest variance direction -> pick u,w,v minimal? For simplicity, return normalizing cross of v and w to ensure orthonormal set roughly
	const ev = new THREE.Vector3(v[0], v[1], v[2]).normalize();
	const ew = new THREE.Vector3(w[0], w[1], w[2]).normalize();
	let n = new THREE.Vector3().crossVectors(ev, ew).normalize();
	if (!Number.isFinite(n.x)) n = new THREE.Vector3(0, 0, 1);
	return n;
}

// Conic fit utilities
function fitConic(pts2) {
	if (pts2.length < 5) return null;
	// Build design matrix D
	const D = [];
	for (const p of pts2) {
		const x = p.x, y = p.y;
		D.push([x * x, x * y, y * y, x, y, 1]);
	}
	const svd = svdDecompose(D);
	if (!svd) return null;
	const V = svd.V; // columns are right singular vectors
	const p = V.map(row => row[5]); // last column
	return { a: p[0], b: p[1], c: p[2], d: p[3], e: p[4], f: p[5] };
}

function isHyperbolaConic(conic) {
	const { a, b, c } = conic;
	return (4 * a * c - b * b) < 0;
}

function sampleHyperbolaConic(conic, samplePts, count) {
	// Sample within bbox of samplePts
	let minX = Infinity, maxX = -Infinity;
	for (const p of samplePts) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; }
	const xs = [];
	for (let i = 0; i < count; i++) xs.push(minX + (maxX - minX) * (i / (count - 1)));
	const res = [];
	const { a, b, c, d, e, f } = conic;
	for (const x of xs) {
		// Solve quadratic in y: (c) y^2 + (b x + e) y + (a x^2 + d x + f) = 0
		const qa = c;
		const qb = b * x + e;
		const qc = a * x * x + d * x + f;
		const disc = qb * qb - 4 * qa * qc;
		if (disc < 0) continue;
		const sdisc = Math.sqrt(Math.max(0, disc));
		const y1 = (-qb + sdisc) / (2 * qa);
		const y2 = (-qb - sdisc) / (2 * qa);
		// Pick branch closer to sample median y
		const medianY = samplePts.map(p => p.y).sort((m, n) => m - n)[Math.floor(samplePts.length / 2)];
		const y = Math.abs(y1 - medianY) < Math.abs(y2 - medianY) ? y1 : y2;
		res.push({ x, y });
	}
	// Ensure monotonic order by x
	res.sort((p, q) => p.x - q.x);
	return res;
}

// Auto pick 3 internal samples along the polyline by cumulative arc length ratios
function pickAutoThreeSamples(poly) {
	const ratios = [0.25, 0.5, 0.75];
	const cum = [0];
	let total = 0;
	for (let i = 1; i < poly.length; i++) {
		total += poly[i - 1].distanceTo(poly[i]);
		cum.push(total);
	}
	if (total === 0) return [];
	const res = [];
	for (const r of ratios) {
		const target = r * total;
		// locate segment
		let j = 1; while (j < cum.length && cum[j] < target) j++;
		if (j >= cum.length) { res.push(poly[poly.length - 1].clone()); continue; }
		const segLen = cum[j] - cum[j - 1];
		const t = segLen > 0 ? (target - cum[j - 1]) / segLen : 0;
		const p = poly[j - 1].clone().lerp(poly[j], t);
		res.push(p);
	}
	return res;
}

// Fit general conic with constraints passing through two endpoints; least squares on middle three
// Conic form: A x^2 + B x y + C y^2 + D x + E y + F = 0 (vector q=[A,B,C,D,E,F])
function fitConicConstrainedThrough(p1, p2, middlePts) {
	// Constraint matrix C q = 0 for endpoints
	function rowFromPoint(pt) { const x = pt.x, y = pt.y; return [x * x, x * y, y * y, x, y, 1]; }
	const C = [rowFromPoint(p1), rowFromPoint(p2)];
	// Nullspace of C (dimension 4)
	const Ns = nullSpace(C);
	if (!Ns) return null;
	// Represent q = Ns * z, minimize ||A q|| where A from middle points
	const A = middlePts.map(rowFromPoint);
	// Build M = A * Ns, solve min ||M z|| -> eigen of (M^T M)
	const M = A.map(aRow => {
		const out = new Array(Ns[0].length).fill(0);
		for (let j = 0; j < Ns.length; j++) {
			const coeff = aRow[j];
			for (let k = 0; k < Ns[0].length; k++) out[k] += coeff * Ns[j][k];
		}
		return out;
	});
	const MtM = Array.from({ length: Ns[0].length }, () => Array(Ns[0].length).fill(0));
	for (let i = 0; i < M.length; i++) for (let j = 0; j < MtM.length; j++) for (let k = 0; k < MtM.length; k++) MtM[j][k] += M[i][j] * M[i][k];
	const eig = eigenSymmetric(MtM);
	if (!eig) return null;
	const order = eig.values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v).map(o => o.i);
	const z = order.map(i => (i === 0 ? 1 : 0)); // take eigenvector with min eigenvalue; build explicit vector below
	// Actually need the actual eigenvector column
	const V = eig.vectors;
	const zvec = V.map(row => row[order[0]]);
	// q = Ns * zvec
	const q = new Array(6).fill(0);
	for (let j = 0; j < Ns.length; j++) for (let k = 0; k < Ns[0].length; k++) q[j] += Ns[j][k] * zvec[k];
	return { a: q[0], b: q[1], c: q[2], d: q[3], e: q[4], f: q[5] };
}

// Compute nullspace basis of matrix C (m x n), return n x r matrix columns as basis
function nullSpace(C) {
	const m = C.length; const n = C[0].length;
	// SVD of C to get V; nullspace are columns where singular value ~ 0
	const svd = svdDecompose(C);
	if (!svd) return null;
	const V = svd.V; // n x n
	// We need last n - rank columns; with two constraints on general position -> rank 2 -> r=4
	const r = Math.max(1, n - 2);
	const Ns = Array.from({ length: n }, () => Array(r).fill(0));
	for (let j = 0; j < r; j++) {
		const col = V.map(row => row[n - r + j]);
		for (let i = 0; i < n; i++) Ns[i][j] = col[i];
	}
	return Ns;
}

// Sample the constrained hyperbola ensuring endpoints are included as first/last samples
function sampleHyperbolaConicConstrained(conic, end1, end2, mids, count) {
	// Sample by x between endpoints in 2D; ensure end1->end2 ordering by x
	let a = end1, b = end2;
	let reverse = false;
	if (a.x > b.x) { const t = a; a = b; b = t; reverse = true; }
	const xs = [];
	for (let i = 0; i < count; i++) xs.push(a.x + (b.x - a.x) * (i / (count - 1)));
	const { A, branchYs } = precomputeBranchSelector(conic, mids);
	const res = [];
	for (let i = 0; i < xs.length; i++) {
		const x = xs[i];
		const ys = solveConicY(conic, x);
		if (!ys) continue;
		const y = selectBranch(ys, branchYs);
		res.push({ x, y });
	}
	if (reverse) res.reverse();
	// Replace first/last exactly with endpoints to enforce pass-through
	if (res.length) { res[0] = { x: end1.x, y: end1.y }; res[res.length - 1] = { x: end2.x, y: end2.y }; }
	return res;
}

function precomputeBranchSelector(conic, mids) {
	const branchYs = mids.map(p => p.y).sort((a, b) => a - b);
	return { A: 0, branchYs };
}

function solveConicY(conic, x) {
	const { a, b, c, d, e, f } = conic;
	const qa = c;
	const qb = b * x + e;
	const qc = a * x * x + d * x + f;
	const disc = qb * qb - 4 * qa * qc;
	if (disc < 0) return null;
	const s = Math.sqrt(Math.max(0, disc));
	return [(-qb + s) / (2 * qa), (-qb - s) / (2 * qa)];
}

function selectBranch(ys, branchYs) {
	// choose y closer to median of middle samples
	const median = branchYs[Math.floor(branchYs.length / 2)];
	return Math.abs(ys[0] - median) < Math.abs(ys[1] - median) ? ys[0] : ys[1];
}

// Basic SVD via numeric.js-like power method fallback (small sizes)
function svdDecompose(A) {
	// Use Gram matrix to get V via eigen of A^T A, then compute U,S lightly. Sufficient to get V's last column.
	const m = A.length; if (m === 0) return null; const n = A[0].length;
	// Compute AtA
	const AtA = Array.from({ length: n }, () => Array(n).fill(0));
	for (let i = 0; i < m; i++) {
		for (let j = 0; j < n; j++) {
			for (let k = 0; k < n; k++) {
				AtA[j][k] += A[i][j] * A[i][k];
			}
		}
	}
	// Eigen decomposition of AtA (symmetric)
	const eig = eigenSymmetric(AtA);
	if (!eig) return null;
	// Sort by eigenvalues ascending (smallest gives smallest singular vector)
	const idx = eig.values.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v).map(o => o.i);
	const V = eig.vectors.map(row => idx.map(i => row[i]));
	return { V };
}

function eigenSymmetric(M) {
	const n = M.length;
	// Jacobi eigenvalue algorithm
	let A = M.map(row => row.slice());
	let V = Array.from({ length: n }, (_, i) => {
		const r = Array(n).fill(0); r[i] = 1; return r;
	});
	for (let iter = 0; iter < 50; iter++) {
		// find largest off-diagonal
		let p = 0, q = 1, max = Math.abs(A[0][1]);
		for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
			const val = Math.abs(A[i][j]);
			if (val > max) { max = val; p = i; q = j; }
		}
		if (max < 1e-10) break;
		const app = A[p][p], aqq = A[q][q], apq = A[p][q];
		const phi = 0.5 * Math.atan2(2 * apq, (aqq - app));
		const c = Math.cos(phi), s = Math.sin(phi);
		// Rotate A
		for (let i = 0; i < n; i++) {
			const aip = A[i][p], aiq = A[i][q];
			A[i][p] = c * aip - s * aiq;
			A[i][q] = s * aip + c * aiq;
		}
		for (let j = 0; j < n; j++) {
			const apj = A[p][j], aqj = A[q][j];
			A[p][j] = c * apj - s * aqj;
			A[q][j] = s * apj + c * aqj;
		}
		A[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
		A[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
		A[p][q] = A[q][p] = 0;
		// Rotate V
		for (let i = 0; i < n; i++) {
			const vip = V[i][p], viq = V[i][q];
			V[i][p] = c * vip - s * viq;
			V[i][q] = s * vip + c * viq;
		}
	}
	const values = Array.from({ length: n }, (_, i) => A[i][i]);
	return { values, vectors: V };
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
	
	// 限制路径点数量为控制点数量
	const limitedPoints = limitPathPoints(pathPoints, controlPointsCount);
	
	// 使用平滑曲线算法生成更多点
	const smoothPoints = generateSmoothCurve(limitedPoints);
	
	// 清除现有路径并设置新路径
	saveState();
	points = smoothPoints;
	redrawScene();
	
	setStatus(`已生成包含 ${smoothPoints.length} 个点的平滑路径`);
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

// 生成平滑曲线
function generateSmoothCurve(controlPoints) {
	if (controlPoints.length < 2) return controlPoints;
	
	// 使用CatmullRom曲线生成平滑路径
	const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'catmullrom', 0.5);
	
	// 使用用户设置的点数来创建平滑曲线
	const smoothPoints = curve.getPoints(smoothPointsCount);
	
	return smoothPoints;
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
			controlPointsCount = params.controlPointsCount || 10;
			smoothPointsCount = params.smoothPointsCount || 50;
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
			controlPointsCount,
			smoothPointsCount
		};
		localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(params));
	} catch (err) {
		console.warn('Failed to save parameters:', err);
	}
}

function showSettingsModal() {
	wireDiameterInput.value = (wireRadius * 2).toFixed(1);
	markerDiameterInput.value = (markerRadius * 2).toFixed(1);
	controlPointsInput.value = controlPointsCount;
	smoothPointsInput.value = smoothPointsCount;
	settingsModal.classList.remove('hidden');
}

function hideSettingsModal() {
	settingsModal.classList.add('hidden');
}

function saveSettings() {
	const newWireDiameter = parseFloat(wireDiameterInput.value);
	const newMarkerDiameter = parseFloat(markerDiameterInput.value);
	const newControlPoints = parseInt(controlPointsInput.value);
	const newSmoothPoints = parseInt(smoothPointsInput.value);

	if (!isNaN(newWireDiameter) && newWireDiameter > 0) wireRadius = newWireDiameter / 2;
	if (!isNaN(newMarkerDiameter) && newMarkerDiameter > 0) markerRadius = newMarkerDiameter / 2;
	if (!isNaN(newControlPoints) && newControlPoints >= 3 && newControlPoints <= 20) controlPointsCount = newControlPoints;
	if (!isNaN(newSmoothPoints) && newSmoothPoints >= 20 && newSmoothPoints <= 200) smoothPointsCount = newSmoothPoints;

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
		} else if (mode === 'parabola') {
			if (isContactPointsMode) toggleContactPointsMode();
			if (isHyperbolaMode) exitHyperbolaMode();
			enterParabolaMode();
		} else {
			if (isContactPointsMode) {
				toggleContactPointsMode(); // 退出接触点模式
			}
			if (isHyperbolaMode) {
				exitHyperbolaMode();
			}
			if (isParabolaMode) {
				exitParabolaMode();
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
