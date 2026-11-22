export interface WritingQuestion {question:string;options:string[];multiple?:boolean}
export interface QuestionAnswer {selected:number[];note:string;skipped?:boolean}
export function validateQuestions(value:unknown):WritingQuestion[]{
 if(!Array.isArray(value)||value.length<1||value.length>3)throw Error('方向问卷需包含1—3题');
 return value.map(q=>{if(!q||typeof q!=='object'||Object.keys(q).some(k=>!['question','options','multiple'].includes(k))||typeof q.question!=='string'||!q.question.trim()||q.question.length>200||!Array.isArray(q.options)||q.options.length<2||q.options.length>4||q.options.some((s:unknown)=>typeof s!=='string'||!s.trim()||s.length>80)||new Set(q.options).size!==q.options.length||q.multiple!==undefined&&typeof q.multiple!=='boolean')throw Error('每题需有问题及2—4个不同选项');return {question:q.question,options:[...q.options],multiple:q.multiple===true};});
}
export function validateAnswers(questions:WritingQuestion[],value:unknown):QuestionAnswer[]{
 if(!Array.isArray(value)||value.length!==questions.length)throw Error('回答与问题数量不一致');
 return value.map((a,i)=>{if(!a||typeof a!=='object'||!Array.isArray(a.selected)||a.selected.some((n:unknown)=>!Number.isInteger(n)||Number(n)<0||Number(n)>=questions[i].options.length)||new Set(a.selected).size!==a.selected.length||!questions[i].multiple&&a.selected.length>1||typeof a.note!=='string'||a.note.length>2000||a.skipped!==undefined&&typeof a.skipped!=='boolean')throw Error('回答内容无效');return {selected:[...a.selected].sort((a,b)=>a-b),note:a.note,skipped:a.skipped===true};});
}
export function questionReply(questions:WritingQuestion[],answers:QuestionAnswer[]){return questions.map((q,i)=>`${i+1}. ${q.question}\n${answers[i].skipped?'跳过，请按现有信息继续。':answers[i].selected.map(n=>q.options[n]).join('、')+(answers[i].note.trim()?`\n补充：${answers[i].note.trim()}`:'')}`).join('\n\n');}
