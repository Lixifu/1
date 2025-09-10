// UI helper placeholder for later modules (plane setup, drawing, etc.)
export function formatNumber(n, digits = 2) {
	const num = Number(n);
	if (Number.isNaN(num)) return '';
	return num.toFixed(digits);
}
