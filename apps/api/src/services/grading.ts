export function normalizeAnswer(text: string): string {
  const digits = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';
  return text.replace(/[٠-٩۰-۹]/g, c => String(digits.indexOf(c) % 10))
    .replace(/[\u064b-\u0652\u0670\u0640]/g, '').replace(/[إأآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .toLowerCase().replace(/[.,!?:;"'()[\]{}،؟؛\-_/\\|]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function checkEssay(answer: string, model: string): boolean {
  const student = normalizeAnswer(answer);
  if (!student || !model.trim()) return false;
  const alternatives = [...model.split(/[\n\r/؛;,،]+/), model].map(normalizeAnswer).filter(Boolean);
  return alternatives.some(a => student === a || (!/^\d+$/.test(a) && a.length >= 3 && ` ${student} `.includes(` ${a} `)));
}
