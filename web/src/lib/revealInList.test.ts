import {describe,expect,it} from 'vitest';
import {revealInList} from './revealInList';

/** Just the box geometry the helper reads; a list 100 px tall starting 500 px down the page. */
function listWithItem(itemTop:number){
  const list={scrollTop:0,clientHeight:100,clientTop:0,getBoundingClientRect:()=>({top:500})};
  const item={offsetHeight:20,getBoundingClientRect:()=>({top:500+itemTop-list.scrollTop})};
  return {list:list as unknown as HTMLElement,item:item as unknown as HTMLElement};
}

describe('revealInList',()=>{
  it('scrolls the list just far enough to show a hidden option',()=>{
    const {list,item}=listWithItem(150);
    revealInList(list,item);
    expect(list.scrollTop).toBe(70);
  });

  it('leaves a visible option alone and centres on request',()=>{
    const {list,item}=listWithItem(40);
    revealInList(list,item);
    expect(list.scrollTop).toBe(0);
    const far=listWithItem(300);
    revealInList(far.list,far.item,'center');
    expect(far.list.scrollTop).toBe(260);
  });
});
