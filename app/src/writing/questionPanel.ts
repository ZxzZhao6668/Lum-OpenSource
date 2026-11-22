import {validateQuestions,validateAnswers,questionReply,type QuestionAnswer} from './questions';
import {node} from '../ui/localUi';
import type {WritingMessage} from './writingSession';
export function renderQuestions(host:HTMLElement,message:WritingMessage,running:boolean,save:(answers:QuestionAnswer[])=>Promise<void>,fill:(text:string)=>void){
 if(!message.questionnaire){host.textContent=message.question?`需要你补充：${message.question}`:'';host.hidden=!message.question;return;}
 host.hidden=false;const signature=JSON.stringify(message.questionnaire);
 if(host.dataset.questions!==signature){
  const questions=validateQuestions(message.questionnaire);let answers=validateAnswers(questions,message.answers??questions.map(()=>({selected:[],note:''})));host.replaceChildren();host.dataset.questions=signature;
  const status=node('p','','wp-muted');status.setAttribute('role','status');
  const persist=()=>void save(answers).then(()=>{status.textContent='回答已保存，填入后发送继续。';}).catch(e=>{status.textContent=String(e.message??e);});
  questions.forEach((q,i)=>{const group=node('fieldset');group.append(node('legend',q.question+(q.multiple?'（可多选）':'')));const inputs:HTMLInputElement[]=[];
   q.options.forEach((option,n)=>{const label=node('label','','wp-question-option'),input=node('input');input.type=q.multiple?'checkbox':'radio';input.name=`${message.id}-${i}`;input.checked=answers[i].selected.includes(n);inputs.push(input);input.onchange=()=>{answers[i].selected=inputs.flatMap((c,j)=>c.checked?[j]:[]);answers[i].skipped=false;persist();};label.append(input,node('span',option));group.append(label);});
   const note=node('textarea');note.rows=2;note.maxLength=2000;note.placeholder='补充说明（可选）';note.setAttribute('aria-label',q.question+' 补充说明');note.value=answers[i].note;note.oninput=()=>{answers[i].note=note.value;answers[i].skipped=false;persist();};group.append(note);host.append(group);
  });
  const accept=node('button','填入回答','wp-button');accept.type='button';accept.onclick=()=>{if(answers.some(a=>!a.selected.length&&!a.note.trim()&&!a.skipped)){status.textContent='请为每题选择选项、填写补充，或跳过问卷。';return;}fill(questionReply(questions,answers));};
  const skip=node('button','跳过问卷','wp-button');skip.type='button';skip.onclick=()=>{answers=answers.map(a=>({...a,skipped:true}));persist();fill(questionReply(questions,answers));};host.append(status,accept,skip);
 }
 host.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLButtonElement>('input,textarea,button').forEach(el=>el.disabled=running);
}
