/**
 * UI辅助函数
 * 用于平面设置、绘制等后续模块的占位符
 */

/**
 * 格式化数字
 * @param {number} n - 要格式化的数字
 * @param {number} digits - 小数位数，默认为2
 * @returns {string} 格式化后的数字字符串
 */
export function formatNumber(n, digits = 2) {
	const num = Number(n);
	if (Number.isNaN(num)) return '';
	return num.toFixed(digits);
}
