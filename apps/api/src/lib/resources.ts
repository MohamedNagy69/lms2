import { z } from 'zod';
export type Field = { key: string; label: string; type: 'text'|'textarea'|'number'|'boolean'|'select'|'reference'|'file'; required?: boolean; max?: number; min?: number; value?: any; options?: string[]; reference?: string };
const f = (key: string, label: string, type: Field['type'] = 'text', options: Partial<Field> = {}): Field => ({ key, label, type, ...options });
const title = f('title','العنوان','text',{required:true,max:150});
const description = f('description','الوصف','textarea');
const order = f('order','الترتيب','number',{value:0});
const ref = (key: string, label: string, reference: string, required = true) => f(key,label,'reference',{reference,required});
const yes = (key: string, label: string, value = true) => f(key,label,'boolean',{value});
export const resources: Record<string, { table: string; label: string; fields: Field[] }> = {
  grades: { table:'grades', label:'الصفوف الدراسية', fields:[f('name','الاسم','text',{required:true,max:80}),f('slug','الرابط','text',{max:90}),order,yes('is_active','مفعّل')] },
  courses: { table:'courses', label:'الكورسات', fields:[title,f('slug','الرابط','text',{max:170}),ref('grade_id','الصف','grades'),f('summary','ملخص','text',{max:250}),description,yes('is_free','مجاني',false),yes('is_published','منشور'),yes('enable_watermark','العلامة المائية'),f('master_access_code','كود الاشتراك الموحد','text',{max:50}),f('emoji','الأيقونة','text',{max:8,value:'📘'}),f('accent','اللون','select',{options:['brand','emerald','amber','rose','violet'],value:'brand'}),order] },
  lectures: { table:'lectures', label:'المحاضرات', fields:[ref('course_id','الكورس','courses'),title,description,order] },
  lessons: { table:'lessons', label:'الدروس', fields:[ref('lecture_id','المحاضرة','lectures'),title,description,f('video_source','مصدر الفيديو','select',{options:['youtube','drive','file'],value:'youtube'}),f('youtube_id','رابط يوتيوب أو كود التضمين','text',{max:2000}),f('drive_url','رابط جوجل درايف أو كود التضمين','text',{max:2000}),f('video_file','ملف الفيديو','file'),f('duration_minutes','المدة بالدقائق','number',{min:0,value:0}),order,yes('is_preview','معاينة مجانية',false),yes('enable_watermark','العلامة المائية')] },
  attachments: { table:'attachments', label:'المرفقات', fields:[ref('lesson_id','الدرس','lessons'),title,f('kind','النوع','select',{options:['file','link'],value:'file'}),f('file','ملف','file'),f('url','الرابط','text',{max:2048})] },
  exams: { table:'exams', label:'الامتحانات', fields:[ref('course_id','الكورس','courses'),ref('lesson_id','الدرس','lessons',false),title,description,f('duration_minutes','المدة بالدقائق','number',{min:1,value:15}),f('pass_percent','نسبة النجاح','number',{min:0,max:100,value:50}),yes('is_published','منشور'),yes('allow_retake','السماح بالإعادة'),f('max_attempts','عدد المحاولات (0 = بلا حد)','number',{min:0,value:1}),yes('require_webcam','تشغيل الكاميرا',false),yes('require_fullscreen','ملء الشاشة'),yes('prevent_copy_paste','منع النسخ واللصق'),yes('shuffle_questions','ترتيب عشوائي',false),yes('ai_multi_person_detection','رصد أكثر من شخص'),yes('ai_absence_and_camera_block','رصد غياب الوجه'),yes('prevent_multiple_screens','التحقق من الشاشات المتعددة'),f('max_infractions','حد الإنذارات (0 = بلا حد)','number',{min:0,value:3}),yes('auto_send_result','إرسال النتائج تلقائيًا')] },
  questions: { table:'questions', label:'الأسئلة', fields:[ref('exam_id','الامتحان','exams'),f('question_type','نوع السؤال','select',{options:['mcq','essay'],value:'mcq'}),f('text','نص السؤال','textarea',{required:true}),f('image','صورة السؤال','file'),f('points','الدرجة','number',{min:1,value:1}),order,f('explanation','الشرح / نموذج الإجابة','textarea')] },
  choices: { table:'choices', label:'الاختيارات', fields:[ref('question_id','السؤال','questions'),f('text','نص الاختيار','text',{required:true,max:250}),yes('is_correct','الإجابة الصحيحة',false),order] },
  announcements: { table:'announcements', label:'الإعلانات', fields:[title,f('body','النص','textarea',{required:true}),ref('grade_id','الصف (فارغ = الجميع)','grades',false),yes('is_pinned','مثبت',false)] },
  testimonials: { table:'testimonials', label:'آراء الطلاب', fields:[f('student_name','اسم الطالب','text',{required:true,max:80}),f('grade_name','الصف','text',{max:80}),f('text','الرأي','textarea',{required:true}),f('rating','التقييم','number',{min:1,max:5,value:5}),yes('is_visible','ظاهر')] },
};
export function resourceSchema(name: string, partial = false) {
  const resource = resources[name]!;
  const shape: Record<string,z.ZodType> = {};
  for (const field of resource.fields) {
    let type: z.ZodType;
    switch(field.type) {
      case 'boolean': type = z.boolean().default(field.value ?? false); break;
      case 'number': type = z.number().int().min(field.min ?? -1000000).max(field.max ?? 10000000).default(field.value ?? 0); break;
      case 'reference': type = field.required ? z.number().int().positive() : z.number().int().positive().nullable().default(null); break;
      case 'select': type = z.enum(field.options as [string,...string[]]).default(field.value ?? field.options![0]); break;
      default: {
        let str = z.string().trim().max(field.max ?? (field.type === 'textarea' ? 50000 : 500));
        if (field.required) str = str.min(1);
        if (field.type === 'file') str = str.refine(v => !v || /^(videos|attachments|questions)\/[^/\\]+$/.test(v) && !v.split('/').includes('..'), 'مسار الملف غير صالح');
        if (field.key === 'url') str = str.refine(v => !v || /^https?:\/\//i.test(v), 'الرابط يجب أن يبدأ بـ https://');
        type = field.required ? str : str.default(field.value ?? '');
      }
    }
    shape[field.key] = type;
  }
  const schema = z.object(shape).strict();
  return partial ? schema.partial() : schema;
}
