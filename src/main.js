import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DragControls } from 'three/addons/controls/DragControls.js';

// 全局变量定义
let scene, camera, renderer, controls; // 场景、相机、渲染器、控制器
let modelMesh = null; // 3D模型网格
let points = []; // 路径点数组
let archCurveObject = null; // 弓丝曲线对象
let pointMarkers = []; // 点标记数组
let draggableObjects = []; // 可拖拽对象数组

// 参考平面设置
let planeControlPoints = []; // 平面控制点数组
let referencePlaneMesh = null; // 参考平面网格
let planeNormal = new THREE.Vector3(0, 1, 0); // 平面法向量
let planeDragControls = null; // 平面拖拽控制器

// 操作模式
let isPlaneMode = false; // 平面模式
let isDrawingMode = false; // 绘制模式
let isEditMode = false; // 编辑模式
let isContactPointsMode = false; // 接触点模式
let isParabolaMode = false; // 抛物线模式
let isMultiSelectMode = false; // 多选模式

// U型曲选择相关
const SELECTION_COLOR_ULOOP = 0x9932CC; // U型曲选择颜色（紫色）
const SELECTION_COLOR_ULOOP_MIDDLE = 0xFFA500; // 中间点颜色（橙色）
let uLoopSelectionIndices = []; // U型曲选择索引数组

// 多选模式相关
const MULTI_SELECT_COLOR = 0xFFD700; // 多选点颜色（金色）
let multiSelectedIndices = []; // 多选点索引数组

// 接触点模式
let contactPoints = []; // 接触点数组
let contactPointMarkers = []; // 接触点标记数组
let selectedContactPoints = []; // 选中的接触点数组
const CONTACT_POINT_COLOR = 0x00FF00; // 接触点颜色（绿色）
const SELECTED_CONTACT_POINT_COLOR = 0xFF6600; // 选中接触点颜色（橙色）


// 抛物线模式状态
let parabolaPickedPoints = []; // 抛物线拾取的点
let parabolaMarkers = []; // 抛物线标记
const PARABOLA_MARKER_COLOR = 0x00BFFF; // 抛物线标记颜色


// 撤销历史
let historyStack = []; // 历史状态栈

// UI元素
const canvas = document.getElementById('mainCanvas'); // 主画布
const stlInput = document.getElementById('stl-input'); // STL文件输入
const jsonImport = document.getElementById('json-import'); // JSON导入
const exportBtn = document.getElementById('export-json'); // 导出按钮
const opacitySlider = document.getElementById('opacity'); // 透明度滑块
const statusEl = document.getElementById('status'); // 状态显示
const planeStatusEl = document.getElementById('plane-status'); // 平面状态显示
const enterPlaneBtn = document.getElementById('enter-plane-mode'); // 进入平面模式按钮
const confirmPlaneBtn = document.getElementById('confirm-plane'); // 确认平面按钮
const togglePlaneVisibilityBtn = document.getElementById('toggle-plane-visibility'); // 切换平面可见性按钮
const designModeSelect = document.getElementById('design-mode'); // 设计模式选择
const toggleDrawBtn = document.getElementById('toggle-draw'); // 切换绘制按钮
const toggleEditBtn = document.getElementById('toggle-edit'); // 切换编辑按钮
const toggleMultiSelectBtn = document.getElementById('toggle-multi-select'); // 切换多选按钮
const clearAllBtn = document.getElementById('clear-all'); // 清除全部按钮
const generateUloopBtn = document.getElementById('generate-uloop'); // 生成U型曲按钮
const undoBtn = document.getElementById('undo'); // 撤销按钮
const openSettingsBtn = document.getElementById('open-settings'); // 打开设置按钮
const settingsModal = document.getElementById('settings-modal'); // 设置模态框
const cancelSettingsBtn = document.getElementById('cancel-settings'); // 取消设置按钮
const saveSettingsBtn = document.getElementById('save-settings'); // 保存设置按钮
const wireDiameterInput = document.getElementById('wire-diameter-input'); // 弓丝直径输入
const markerDiameterInput = document.getElementById('marker-diameter-input'); // 标记直径输入
const controlPointsInput = document.getElementById('control-points-input'); // 控制点数量输入
const smoothPointsInput = document.getElementById('smooth-points-input'); // 平滑曲线点数输入
// 已移除U型曲参数

// 几何参数（使用设计规格的默认值）
let wireRadius = 0.4; // 弓丝半径（毫米，视觉管半径）
let markerRadius = 0.4; // 标记半径（毫米，标记球半径）
let controlPointsCount = 10; // 控制点数量
let smoothPointsCount = 50; // 平滑曲线点数

// 参数存储键
const PARAMS_STORAGE_KEY = 'dental_designer_params';

// 交互辅助工具
const raycaster = new THREE.Raycaster(); // 射线投射器
const mouse = new THREE.Vector2(); // 鼠标位置
let isDraggingView = false; // 是否正在拖拽视图
let mouseDownPos = new THREE.Vector2(); // 鼠标按下位置
let dragControls = null; // 拖拽控制器

/**
 * 设置状态消息
 * @param {string} message - 要显示的状态消息
 */
function setStatus(message) {
	statusEl.textContent = message || '';
}

/**
 * 初始化3D场景
 * 创建场景、相机、渲染器、光照和控制器
 */
function initScene() {
	scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0b1220);

	camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
	camera.position.set(0, 0, 150);

	renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(window.innerWidth, window.innerHeight);

	// 环境光 - 提供基础照明
	const ambient = new THREE.AmbientLight(0xffffff, 0.4);
	scene.add(ambient);
	
	// 主方向光 - 从右前方照射
	const mainDir = new THREE.DirectionalLight(0xffffff, 0.8);
	mainDir.position.set(50, 60, 120);
	scene.add(mainDir);
	
	// 补充方向光1 - 从左前方照射
	const dir1 = new THREE.DirectionalLight(0xffffff, 0.6);
	dir1.position.set(-50, 40, 100);
	scene.add(dir1);
	
	// 补充方向光2 - 从后方照射
	const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
	dir2.position.set(0, 30, -100);
	scene.add(dir2);
	
	// 补充方向光3 - 从上方照射
	const dir3 = new THREE.DirectionalLight(0xffffff, 0.5);
	dir3.position.set(0, 100, 0);
	scene.add(dir3);
	
	// 补充方向光4 - 从下方照射
	const dir4 = new THREE.DirectionalLight(0xffffff, 0.3);
	dir4.position.set(0, -80, 0);
	scene.add(dir4);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = false;

	window.addEventListener('resize', onWindowResize);

	// 画布交互事件
	canvas.addEventListener('mousedown', onCanvasMouseDown, true);
	canvas.addEventListener('mousemove', onCanvasMouseMove, false);
	canvas.addEventListener('mouseup', onCanvasMouseUp, false);
	window.addEventListener('keydown', (event) => {
		if (event.ctrlKey && (event.key === 'z' || event.key === 'Z')) {
			undo();
		}
	});

	// 加载保存的参数
	loadParameters();

	animate();
}

/**
 * 处理窗口大小变化
 * 更新相机宽高比和渲染器尺寸
 */
function onWindowResize() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
}

/**
 * 加载STL文件
 * @param {File} file - STL文件对象
 */
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

/**
 * 启用平面UI
 * 设置平面相关按钮的状态
 */
function enablePlaneUI() {
	enterPlaneBtn.disabled = false;
	confirmPlaneBtn.disabled = true;
	togglePlaneVisibilityBtn.disabled = true;
	togglePlaneVisibilityBtn.textContent = '隐藏平面';
	planeStatusEl.textContent = '请在牙模上点击3个点来定义平面。';
}

/**
 * 进入平面模式
 * 设置平面模式状态并隐藏路径编辑
 */
function enterPlaneMode() {
	isPlaneMode = true;
	isDrawingMode = false;
	isEditMode = false;
	updateModeButtons();
	planeStatusEl.textContent = `请在牙模上点击 ${Math.max(0, 3 - planeControlPoints.length)} 个点来定义平面。`;
	// 在平面模式下隐藏路径编辑
	setMarkersVisibility(false);
	if (archCurveObject) archCurveObject.visible = false;
	setupPlaneDragControls();
}

/**
 * 确认平面
 * 退出平面模式并启用设计UI
 */
function confirmPlane() {
	isPlaneMode = false;
	planeStatusEl.textContent = '参考平面已确认。';
	if (planeDragControls) {
		planeDragControls.dispose();
		planeDragControls = null;
	}
	setupPointDragControls();
	// 启用设计UI
	disableDesignUI(false);
	if (archCurveObject) archCurveObject.visible = true;
	togglePlaneVisibilityBtn.disabled = false;
	setStatus('请选择操作模式。');
}

/**
 * 切换平面可见性
 * 显示或隐藏参考平面
 */
function togglePlaneVisibility() {
	if (!referencePlaneMesh) return;
	referencePlaneMesh.visible = !referencePlaneMesh.visible;
	togglePlaneVisibilityBtn.textContent = referencePlaneMesh.visible ? '隐藏平面' : '显示平面';
}

/**
 * 添加平面控制点
 * @param {THREE.Vector3} position - 控制点位置
 */
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
		planeStatusEl.textContent = '平面已定义。可拖动控制点调整，或点击"确认平面"。';
	}
}

/**
 * 设置平面拖拽控制器
 * 允许用户拖拽平面控制点
 */
function setupPlaneDragControls() {
	if (planeDragControls) planeDragControls.dispose();
	planeDragControls = new DragControls(planeControlPoints, camera, renderer.domElement);
	planeDragControls.addEventListener('dragstart', () => { controls.enabled = false; });
	planeDragControls.addEventListener('drag', updateReferencePlane);
	planeDragControls.addEventListener('dragend', () => { controls.enabled = true; });
}

/**
 * 更新参考平面
 * 根据三个控制点重新计算平面
 */
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

/**
 * 计算参考平面与模型的接触点
 * 找到模型表面与参考平面相交的点
 */
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

/**
 * 按照角度对接触点进行排序
 * @param {Array} points - 接触点数组
 * @param {THREE.Vector3} planePosition - 平面位置
 * @param {THREE.Vector3} planeNormal - 平面法向量
 * @returns {Array} 排序后的点数组
 */
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

/**
 * 使用TSP最短路径算法对接触点进行排序
 * @param {Array} points - 接触点数组
 * @returns {Array} 排序后的点数组
 */
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

/**
 * 找到参考平面与模型交线的中心点
 * @param {Array} points - 交点数组
 * @param {THREE.Vector3} planePosition - 平面位置
 * @param {THREE.Vector3} planeNormal - 平面法向量
 * @returns {THREE.Vector3} 中心点
 */
function findIntersectionCurveCenter(points, planePosition, planeNormal) {
	if (points.length === 0) return planePosition;
	
	// 计算所有点的质心
	const center = new THREE.Vector3();
	points.forEach(point => center.add(point));
	center.divideScalar(points.length);
	
	return center;
}

/**
 * 点聚类函数
 * @param {Array} points - 点数组
 * @param {number} radius - 聚类半径
 * @returns {Array} 聚类后的中心点数组
 */
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

/**
 * 创建接触点标记
 * @param {THREE.Vector3} position - 标记位置
 */
function createContactPointMarker(position) {
	const geometry = new THREE.SphereGeometry(0.3, 16, 16);
	const material = new THREE.MeshBasicMaterial({ color: CONTACT_POINT_COLOR });
	const marker = new THREE.Mesh(geometry, material);
	marker.position.copy(position);
	marker.userData = { type: 'contactPoint', index: contactPoints.length };
	scene.add(marker);
	contactPointMarkers.push(marker);
}

/**
 * 清除接触点
 * 移除所有接触点标记和相关数据
 */
function clearContactPoints() {
	contactPointMarkers.forEach(marker => scene.remove(marker));
	contactPointMarkers = [];
	contactPoints = [];
	selectedContactPoints = [];
}

/**
 * 重置平面
 * 清除所有平面控制点和参考平面
 */
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

/**
 * 禁用/启用设计UI
 * @param {boolean} disabled - 是否禁用
 */
function disableDesignUI(disabled) {
	designModeSelect.disabled = disabled;
	toggleDrawBtn.disabled = disabled;
	toggleEditBtn.disabled = disabled;
	toggleMultiSelectBtn.disabled = disabled;
	clearAllBtn.disabled = disabled;
	generateUloopBtn.disabled = true;
	undoBtn.disabled = historyStack.length === 0;
}

/**
 * 更新模式按钮状态
 * 根据当前模式更新按钮文本和状态消息
 */
function updateModeButtons() {
	// 平面模式单独处理
	if (isDrawingMode) {
		toggleDrawBtn.textContent = '结束绘制';
		setStatus('绘制模式：单击牙模添加点。');
	} else {
		toggleDrawBtn.textContent = '开始绘制';
	}
	if (isEditMode) {
		setStatus('编辑模式：拖动点修改路径。按住Shift单击选择三个端点。');
	}
	if (isMultiSelectMode) {
		toggleMultiSelectBtn.textContent = '退出多选';
		setStatus('多选模式：点击选择点，选择两个点后它们之间的所有点都会自动选中，然后拖拽移动。');
	} else {
		toggleMultiSelectBtn.textContent = '多选模式';
	}
	if (isContactPointsMode) {
		setStatus('接触点模式：单击接触点选择起点和终点。');
	}
	if (isParabolaMode) {
		setStatus('抛物线模式：在牙模上点击选择3个点进行拟合。');
	}
	if (!isDrawingMode && !isEditMode && !isPlaneMode && !isContactPointsMode && !isMultiSelectMode) {
		setStatus('请选择操作模式。');
	}
}

/**
 * 切换绘制模式
 * 开启或关闭绘制模式
 */
function toggleDrawMode() {
	isDrawingMode = !isDrawingMode;
	if (isDrawingMode) {
		isEditMode = false;
		isMultiSelectMode = false;
	}
	deselectAllPoints();
	clearMultiSelection();
	updateModeButtons();
}

/**
 * 切换编辑模式
 * 开启或关闭编辑模式
 */
function toggleEditMode() {
	isEditMode = !isEditMode;
	if (isEditMode) {
		isDrawingMode = false;
		isMultiSelectMode = false;
	}
	clearMultiSelection();
	updateModeButtons();
}

/**
 * 切换多选模式
 * 开启或关闭多选模式
 */
function toggleMultiSelectMode() {
	isMultiSelectMode = !isMultiSelectMode;
	if (isMultiSelectMode) {
		isDrawingMode = false;
		isEditMode = false;
		// 清除其他模式的选择
		deselectAllPoints();
		clearMultiSelection();
	}
	updateModeButtons();
}

/**
 * 切换接触点模式
 * 开启或关闭接触点模式，计算或清除接触点
 */
function toggleContactPointsMode() {
	isContactPointsMode = !isContactPointsMode;
	if (isContactPointsMode) {
		isDrawingMode = false;
		isEditMode = false;
		isMultiSelectMode = false;
		// 计算并显示接触点
		calculateContactPoints();
	} else {
		// 清除接触点
		clearContactPoints();
	}
	clearMultiSelection();
	updateModeButtons();
}


/**
 * 进入抛物线模式
 * 清理旧状态并设置抛物线模式
 */
function enterParabolaMode() {
	isParabolaMode = true;
	isDrawingMode = false;
	isEditMode = false;
	isMultiSelectMode = false;
	// 清理旧状态
	clearParabolaWorkingState();
	clearMultiSelection();
	updateModeButtons();
}

/**
 * 退出抛物线模式
 * 清理抛物线工作状态
 */
function exitParabolaMode() {
	isParabolaMode = false;
	clearParabolaWorkingState();
	updateModeButtons();
}


/**
 * 清除绘制
 * 清除所有路径点、标记和曲线
 */
function clearDrawing() {
	deselectAllPoints();
	clearMultiSelection();
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

/**
 * 在光标位置添加点
 * 在鼠标点击的模型表面添加路径点
 */
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

/**
 * 获取偏移点
 * @param {Object} intersect - 射线相交对象
 * @returns {THREE.Vector3} 偏移后的点
 */
function getOffsetPoint(intersect) {
	const surfacePoint = intersect.point;
	const normalMatrix = new THREE.Matrix3().getNormalMatrix(intersect.object.matrixWorld);
	const worldNormal = intersect.face.normal.clone().applyMatrix3(normalMatrix).normalize();
	const offsetVector = worldNormal.multiplyScalar(wireRadius);
	return surfacePoint.clone().add(offsetVector);
}

/**
 * 重绘场景
 * 清除旧标记，重新创建点标记和曲线
 */
function redrawScene() {
	// 清理标记
	pointMarkers.forEach(m => scene.remove(m));
	pointMarkers = [];
	draggableObjects = [];
	points.forEach((p, i) => addPointMarker(p, i));
	updateArchCurve();
	setupPointDragControls();
	updateExportAvailability();
	updateUndoBtn();
}

/**
 * 添加点标记
 * @param {THREE.Vector3} position - 标记位置
 * @param {number} index - 点索引
 */
function addPointMarker(position, index) {
	const isULoopInternal = position.userData && position.userData.isULoopInternal;
	const isULoopSelected = uLoopSelectionIndices.includes(index);
	const isMultiSelected = multiSelectedIndices.includes(index);
	
	let color = 0xff0000; // 默认红色
	if (isULoopSelected) {
		color = SELECTION_COLOR_ULOOP;
	} else if (isMultiSelected) {
		color = MULTI_SELECT_COLOR;
	}
	
	const markerGeometry = new THREE.SphereGeometry(markerRadius, 16, 16);
	const markerMaterial = new THREE.MeshBasicMaterial({ color });
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

/**
 * 设置点拖拽控制器
 * 允许用户拖拽路径点
 */
function setupPointDragControls() {
	if (dragControls) dragControls.dispose();
	dragControls = new DragControls(draggableObjects, camera, renderer.domElement);
	dragControls.addEventListener('dragstart', () => { controls.enabled = false; saveState(); });
	dragControls.addEventListener('drag', (event) => {
		const idx = event.object.userData.index;
		if (typeof idx === 'number') {
			// 如果是多选模式且拖拽的是选中的点，移动所有选中的点
			if (isMultiSelectMode && multiSelectedIndices.includes(idx)) {
				const delta = new THREE.Vector3().subVectors(event.object.position, points[idx]);
				moveSelectedPoints(delta);
			} else {
				// 普通拖拽
				points[idx].copy(event.object.position);
				updateArchCurve();
			}
		}
	});
	dragControls.addEventListener('dragend', (event) => {
		controls.enabled = true;
		const idx = event.object.userData.index;
		
		// 更新颜色
		if (uLoopSelectionIndices.includes(idx)) {
			event.object.material.color.set(SELECTION_COLOR_ULOOP);
		} else if (multiSelectedIndices.includes(idx)) {
			event.object.material.color.set(MULTI_SELECT_COLOR);
		} else {
			event.object.material.color.set(0xff0000);
		}
	});
}

/**
 * 更新弓丝曲线
 * 根据路径点重新生成弓丝曲线
 */
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

/**
 * 设置标记可见性
 * @param {boolean} visible - 是否可见
 */
function setMarkersVisibility(visible) {
	pointMarkers.forEach(m => m.visible = visible && !(m.userData && m.userData.isULoopInternal));
}

/**
 * 更新导出可用性
 * 根据是否有路径点来启用/禁用导出按钮
 */
function updateExportAvailability() {
	exportBtn.disabled = points.length === 0;
}

/**
 * 更新撤销按钮状态
 * 根据历史栈长度启用/禁用撤销按钮
 */
function updateUndoBtn() {
	undoBtn.disabled = historyStack.length === 0;
}

/**
 * 导出JSON文件
 * 将路径点和参考平面信息导出为JSON文件
 */
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

/**
 * 导入JSON文件
 * @param {File} file - JSON文件对象
 */
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

/**
 * 画布鼠标按下事件
 * @param {MouseEvent} event - 鼠标事件
 */
function onCanvasMouseDown(event) {
	if (event.button !== 0) return;
	
	// 编辑模式下使用Shift进行选择
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
	
	// 多选模式下的处理
	if (isMultiSelectMode) {
		raycaster.setFromCamera(mouse, camera);
		const intersects = raycaster.intersectObjects(draggableObjects);
		
		if (intersects.length > 0) {
			// 点击了点标记
			handleMultiSelect(intersects[0].object);
		}
		event.stopImmediatePropagation();
		return;
	}
	
	isDraggingView = false;
	mouseDownPos.set(event.clientX, event.clientY);
}

/**
 * 画布鼠标移动事件
 * @param {MouseEvent} event - 鼠标事件
 */
function onCanvasMouseMove(event) {
	mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
	mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
	
	if (event.buttons !== 1) return;
	if (mouseDownPos.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) {
		isDraggingView = true;
	}
}

/**
 * 画布鼠标抬起事件
 * @param {MouseEvent} event - 鼠标事件
 */
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
	if (isParabolaMode) {
		handleParabolaMouseUp();
	}
}

/**
 * 处理接触点选择
 * 选择接触点并生成路径
 */
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



/**
 * 清除抛物线工作状态
 * 清理抛物线相关的所有状态和对象
 */
function clearParabolaWorkingState() {
	parabolaPickedPoints = [];
	parabolaMarkers.forEach(m => { scene.remove(m); });
	parabolaMarkers = [];
}




/**
 * 处理抛物线模式鼠标抬起事件
 * 选择三个点并生成抛物线路径
 */
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

/**
 * 添加抛物线标记
 * @param {THREE.Vector3} p - 标记位置
 */
function addParabolaMarker(p) {
	const geom = new THREE.SphereGeometry(0.35, 16, 16);
	const mat = new THREE.MeshBasicMaterial({ color: PARABOLA_MARKER_COLOR });
	const marker = new THREE.Mesh(geom, mat);
	marker.position.copy(p);
	scene.add(marker);
	parabolaMarkers.push(marker);
}

/**
 * 生成抛物线路径
 * @param {THREE.Vector3} p1 - 第一个点
 * @param {THREE.Vector3} p2 - 第二个点
 * @param {THREE.Vector3} p3 - 第三个点
 */
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

/**
 * 解3x3线性方程组
 * @param {Array} A - 系数矩阵
 * @param {Array} b - 常数向量
 * @returns {Array|null} 解向量或null
 */
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

/**
 * 计算3x3矩阵的行列式
 * @param {Array} m - 3x3矩阵
 * @returns {number} 行列式值
 */
function det3(m) {
	return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
}

/**
 * 计算3x3矩阵的逆矩阵
 * @param {Array} m - 3x3矩阵
 * @returns {Array|null} 逆矩阵或null
 */
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




















/**
 * 从接触点生成路径
 * 根据选中的接触点生成平滑路径
 */
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


/**
 * 获取两个索引之间的曲线点
 * @param {Array} contactPoints - 接触点数组
 * @param {number} startIndex - 起始索引
 * @param {number} endIndex - 结束索引
 * @returns {Array} 曲线点数组
 */
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

/**
 * 沿着曲线对点进行排序
 * @param {Array} points - 点数组
 * @returns {Array} 排序后的点数组
 */
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

/**
 * 限制路径点数量
 * @param {Array} points - 点数组
 * @param {number} maxPoints - 最大点数
 * @returns {Array} 限制后的点数组
 */
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

/**
 * 生成平滑曲线
 * @param {Array} controlPoints - 控制点数组
 * @returns {Array} 平滑曲线点数组
 */
function generateSmoothCurve(controlPoints) {
	if (controlPoints.length < 2) return controlPoints;
	
	// 使用CatmullRom曲线生成平滑路径
	const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'catmullrom', 0.5);
	
	// 使用用户设置的点数来创建平滑曲线
	const smoothPoints = curve.getPoints(smoothPointsCount);
	
	return smoothPoints;
}


/**
 * 处理U型曲选择
 * @param {Object} marker - 标记对象
 */
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

/**
 * 取消选择所有点
 * 清除U型曲选择状态
 */
function deselectAllPoints() {
	uLoopSelectionIndices.forEach(i => {
		const marker = draggableObjects.find(m => m.userData.index === i);
		if (marker) marker.material.color.set(0xff0000);
	});
	uLoopSelectionIndices = [];
	generateUloopBtn.disabled = true;
}

/**
 * 清除多选状态
 * 清除多选点选择状态
 */
function clearMultiSelection() {
	multiSelectedIndices.forEach(i => {
		const marker = draggableObjects.find(m => m.userData.index === i);
		if (marker) marker.material.color.set(0xff0000);
	});
	multiSelectedIndices = [];
}

/**
 * 处理多选点选择
 * @param {Object} marker - 标记对象
 */
function handleMultiSelect(marker) {
	const index = marker.userData.index;
	const selectionIndex = multiSelectedIndices.indexOf(index);
	
	if (selectionIndex > -1) {
		// 取消选择
		multiSelectedIndices.splice(selectionIndex, 1);
		marker.material.color.set(0xff0000);
	} else {
		// 选择点
		multiSelectedIndices.push(index);
		marker.material.color.set(MULTI_SELECT_COLOR);
		
		// 如果选择了两个或更多点，选择它们之间的所有点
		if (multiSelectedIndices.length >= 2) {
			selectPointsBetweenSelected();
		}
	}
	
	setStatus(`多选模式：已选择 ${multiSelectedIndices.length} 个点`);
}

/**
 * 选择已选中点之间的所有点
 */
function selectPointsBetweenSelected() {
	if (multiSelectedIndices.length < 2) return;
	
	// 找到最小和最大索引
	const minIndex = Math.min(...multiSelectedIndices);
	const maxIndex = Math.max(...multiSelectedIndices);
	
	// 选择中间的所有点
	for (let i = minIndex; i <= maxIndex; i++) {
		if (!multiSelectedIndices.includes(i)) {
			multiSelectedIndices.push(i);
		}
	}
	
	// 更新所有标记的颜色
	updateMultiSelectColors();
}


/**
 * 更新多选点颜色
 */
function updateMultiSelectColors() {
	draggableObjects.forEach(marker => {
		const index = marker.userData.index;
		if (typeof index !== 'number') return;
		
		if (multiSelectedIndices.includes(index)) {
			marker.material.color.set(MULTI_SELECT_COLOR);
		} else if (uLoopSelectionIndices.includes(index)) {
			marker.material.color.set(SELECTION_COLOR_ULOOP);
		} else {
			marker.material.color.set(0xff0000);
		}
	});
}


/**
 * 移动选中的点
 * @param {THREE.Vector3} delta - 移动增量
 */
function moveSelectedPoints(delta) {
	if (multiSelectedIndices.length === 0) return;
	
	// 保存状态
	saveState();
	
	// 移动所有选中的点
	multiSelectedIndices.forEach(index => {
		if (points[index]) {
			points[index].add(delta);
		}
	});
	
	// 更新标记位置
	multiSelectedIndices.forEach(index => {
		const marker = draggableObjects.find(m => m.userData.index === index);
		if (marker && points[index]) {
			marker.position.copy(points[index]);
		}
	});
	
	// 更新曲线
	updateArchCurve();
}


/**
 * 从选择生成U型曲
 * 根据选中的三个点生成U型曲
 */
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

/**
 * 生成U型曲几何
 * @param {THREE.Vector3} baseStart - 基础起点
 * @param {THREE.Vector3} baseEnd - 基础终点
 * @param {THREE.Vector3} y_hat - Y轴方向向量
 * @param {number} height - 高度
 * @returns {Array} U型曲点数组
 */
function generateULoopGeometry(baseStart, baseEnd, y_hat, height) {
	// 不添加额外的宽度偏移，直接使用原始端点作为U型曲的基础
	// 为臂部添加高度
	const armTopStart = baseStart.clone().add(y_hat.clone().multiplyScalar(height));
	const armTopEnd = baseEnd.clone().add(y_hat.clone().multiplyScalar(height));
	
	// 应用端距离偏移（远离组织表面）- 固定值，因为UI已移除
	const endOffset = y_hat.clone().multiplyScalar(1.0); // 使用默认值1.0mm
	armTopStart.add(endOffset);
	armTopEnd.add(endOffset);
	
	const loopPoints = [];
	armTopStart.userData = { type: 'uloop' };
	loopPoints.push(armTopStart);
	
	// 在臂顶部之间生成半圆
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

/**
 * 从三个点生成U型曲
 * @param {THREE.Vector3} p_start - 起点
 * @param {THREE.Vector3} p_mid - 中间点
 * @param {THREE.Vector3} p_end - 终点
 * @returns {Array} U型曲点数组
 */
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

/**
 * 保存状态到撤销栈
 * 保存当前路径点状态
 */
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

/**
 * 如果有路径点则保存状态
 * 检查是否有路径点，如果有则保存状态
 */
function saveStateIfPoints() {
	if (points.length > 0) saveState();
}

/**
 * 撤销操作
 * 恢复到上一个状态
 */
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

/**
 * 加载参数
 * 从本地存储加载保存的参数
 */
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

/**
 * 保存参数
 * 将当前参数保存到本地存储
 */
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

/**
 * 显示设置模态框
 * 显示参数设置对话框
 */
function showSettingsModal() {
	wireDiameterInput.value = (wireRadius * 2).toFixed(1);
	markerDiameterInput.value = (markerRadius * 2).toFixed(1);
	controlPointsInput.value = controlPointsCount;
	smoothPointsInput.value = smoothPointsCount;
	settingsModal.classList.remove('hidden');
}

/**
 * 隐藏设置模态框
 * 隐藏参数设置对话框
 */
function hideSettingsModal() {
	settingsModal.classList.add('hidden');
}

/**
 * 保存设置
 * 保存用户设置的参数
 */
function saveSettings() {
	const newWireDiameter = parseFloat(wireDiameterInput.value);
	const newMarkerDiameter = parseFloat(markerDiameterInput.value);
	const newControlPoints = parseInt(controlPointsInput.value);
	const newSmoothPoints = parseInt(smoothPointsInput.value);

	if (!isNaN(newWireDiameter) && newWireDiameter > 0) wireRadius = newWireDiameter / 2;
	if (!isNaN(newMarkerDiameter) && newMarkerDiameter > 0) markerRadius = newMarkerDiameter / 2;
	if (!isNaN(newControlPoints) && newControlPoints >= 3 && newControlPoints <= 20) controlPointsCount = newControlPoints;
	if (!isNaN(newSmoothPoints) && newSmoothPoints >= 5 && newSmoothPoints <= 200) smoothPointsCount = newSmoothPoints;

	saveParameters();
	redrawScene();
	hideSettingsModal();
}

/**
 * 绑定事件
 * 为所有UI元素绑定事件监听器
 */
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
			enterParabolaMode();
		} else {
			if (isContactPointsMode) {
				toggleContactPointsMode(); // 退出接触点模式
			}
			if (isParabolaMode) {
				exitParabolaMode();
			}
			updateArchCurve();
		}
	});
	toggleDrawBtn.addEventListener('click', () => toggleDrawMode());
	toggleEditBtn.addEventListener('click', () => toggleEditMode());
	toggleMultiSelectBtn.addEventListener('click', () => toggleMultiSelectMode());
	clearAllBtn.addEventListener('click', () => { saveStateIfPoints(); clearDrawing(); });
	generateUloopBtn.addEventListener('click', () => generateULoopFromSelection());
	undoBtn.addEventListener('click', () => undo());
	openSettingsBtn.addEventListener('click', showSettingsModal);
	cancelSettingsBtn.addEventListener('click', hideSettingsModal);
	saveSettingsBtn.addEventListener('click', saveSettings);

	// 设计UI在平面确认前被锁定
	disableDesignUI(true);
}

/**
 * 动画循环
 * 渲染场景并请求下一帧
 */
function animate() {
	restartIfContextLost();
	renderer.render(scene, camera);
	requestAnimationFrame(animate);
}

/**
 * 重启上下文丢失
 * 无操作占位符，为某些浏览器的鲁棒性保留
 */
function restartIfContextLost() {
	// 无操作占位符，为某些浏览器的鲁棒性保留
}

// 初始化场景和事件
initScene();
wireEvents();
