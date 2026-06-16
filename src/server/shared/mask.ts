export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length < 12) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
