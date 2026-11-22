/** Authorization comes from this turn's full user request, never from a model-selected substring. */
export function canWriteWorldview(prompt:string|undefined){
 if(!prompt?.trim())return false;
 const clean=prompt.replace(/「[^」]*」|“[^”]*”|"[^"\n]*"|```[\s\S]*?```/g,'');
 if(/只(?:做)?(?:分析|检查|阅读|讨论|评估|建议)|仅(?:做)?(?:分析|检查|阅读|讨论|评估|建议)|(?:不要|不许|禁止|不准|不能|无需|不用|不需要|别|暂不|不应)[^。！？\n;；]{0,40}(?:写|改|存|添加|新增|更新|补充|完善|建立)|(?:do\s+not|don['’]t|must\s+not|never|without)\s+(?:\w+\s+){0,4}(?:write|edit|modify|save|update|add)|read[ -]?only/i.test(clean))return false;
 return clean.split(/[。！？\n;；]/).some(clause=>/(?:世界观|设定)/.test(clause)&&/(?:写入|写下|写好|保存|存入|修改|改成|添加|新增|更新|补充|完善|建立|创建|记录)/.test(clause));
}
