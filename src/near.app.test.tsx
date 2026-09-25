import{beforeEach,describe,expect,it,vi}from'vitest';
import React from'react';
import{cleanup,fireEvent,render,screen,within}from'@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from'./App';
import{Specimen}from'./types';
import{EARTH_RADIUS_M,NEAR_KEY,pairKey}from'./near';
import{BATCH_KEY}from'./batch';

const KEY='plant-preflight-v1';
const DEG=EARTH_RADIUS_M*Math.PI/180; // 赤道上每经度对应的米数
// 赤道上指定东向米数对应的经度文本
const lon=(meters:number)=>String(meters/DEG);
const rec=(i:number,x:Partial<Specimen>={}):Specimen=>({id:`id${i}`,collectionNo:`N-${i}`,species:'松 Pinus',collector:'甲',date:'2026-03-01',location:'赤道',latitude:'0',longitude:'0',habitat:'',resolutions:{},...x});
const seed=(rows:Specimen[])=>localStorage.setItem(KEY,JSON.stringify(rows));
const openNear=()=>fireEvent.click(screen.getByRole('button',{name:/^近地点复核/}));
const openDesk=()=>fireEvent.click(screen.getByRole('button',{name:'预检工作台'}));
const setRadius=(v:string)=>fireEvent.change(screen.getByLabelText('复核半径，单位米'),{target:{value:v}});
const nearCards=()=>[...document.querySelectorAll('.near-pair')] as HTMLElement[];
const cardByNos=(a:string,b:string)=>nearCards().find(c=>c.textContent!.includes(a)&&c.textContent!.includes(b))!;
const setField=(label:string,value:string)=>{
  const lab=[...screen.getAllByText((_,el)=>!!el&&el.tagName==='SPAN'&&el.closest('.modal')!==null&&el.textContent!.startsWith(label))].find(s=>s.textContent===label||s.textContent===`${label} *`)!;
  fireEvent.change(lab.parentElement!.querySelector('input,textarea')!,{target:{value}});
};
const cardByName=(no:string):HTMLElement=>[...document.querySelectorAll('.record')].find(c=>c.textContent!.includes(no))! as HTMLElement;
const editNo=(no:string,field:string,value:string)=>{
  fireEvent.click(within(cardByName(no)).getByRole('button',{name:'编辑'}));
  setField(field,value);
  fireEvent.click(screen.getByText('保存记录'));
};
const flashErr=()=>document.querySelector('.toast.err')?.textContent||'';
const uploadJson=(text:string)=>{
  const label=screen.getByText('导入 JSON').closest('label')!;
  fireEvent.change(label.querySelector('input[type=file]')!,{target:{files:[new File([text],'b.json',{type:'application/json'})]}});
};

beforeEach(()=>{
  localStorage.clear();
  vi.restoreAllMocks();
  cleanup();
  // jsdom 26 未内置 Blob.text，供 JSON 备份导入使用
  const proto=Blob.prototype as unknown as {text?:unknown};
  if(!proto.text){
    proto.text=function(this:Blob){
      return new Promise<string>((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.onerror=rej;r.readAsText(this)});
    };
  }
});

describe('近地点复核工作区',()=>{
  it('换半径：候选对随半径增减，标签页徽标只统计当前半径下待复核对数',()=>{
    seed([rec(1),rec(2,{longitude:lon(60)}),rec(3,{longitude:lon(200)})]);
    render(<App/>);
    // 默认预检工作台不含复核面板
    expect(screen.queryByText('近地点复核')).not.toBeNull();
    expect(document.querySelector('.near-list')).toBeNull();
    openNear();
    setRadius('50');
    expect(nearCards()).toHaveLength(0);
    expect(screen.getByText('半径 50 米内没有待复核记录对')).toBeInTheDocument();
    setRadius('100');
    expect(nearCards()).toHaveLength(1);
    expect(cardByNos('N-1','N-2')).toBeTruthy();
    const badge=screen.getByRole('button',{name:/近地点复核/}).querySelector('.tab-count');
    expect(badge).toHaveTextContent('1');
    setRadius('1000');
    expect(nearCards()).toHaveLength(3); // C(3,2)=3，不做传递推断
    // 半径非法：不展示任何对，也不报错性破坏
    setRadius('0');
    expect(nearCards()).toHaveLength(0);
    expect(screen.getByText('请输入 1～1000 之间的半径（米）')).toBeInTheDocument();
    setRadius('100');
    expect(nearCards()).toHaveLength(1);
  });

  it('经线两侧：179.99… 与 -179.99… 按跨经线最短距离在 100 米内配对',()=>{
    const d=60/DEG; // 每侧离 180° 经线 60 米，合计约 120 米
    seed([
      rec(1,{collectionNo:'E-1',longitude:String(180-d)}),
      rec(2,{collectionNo:'E-2',longitude:String(-180+d)}),
    ]);
    render(<App/>);
    openNear();
    setRadius('100');
    expect(nearCards()).toHaveLength(0);
    setRadius('150');
    expect(nearCards()).toHaveLength(1);
    const card=cardByNos('E-1','E-2');
    expect(card.querySelector('.near-dist')).toHaveTextContent('120.0 米');
  });

  it('边界距离：实际 100.001 米（展示四舍五入为 100.0 米）在 100 米半径外，101 米半径内',()=>{
    seed([rec(1),rec(2,{longitude:lon(100.001)})]);
    render(<App/>);
    openNear();
    setRadius('100');
    expect(nearCards()).toHaveLength(0);
    setRadius('101');
    expect(nearCards()).toHaveLength(1);
    expect(cardByNos('N-1','N-2').querySelector('.near-dist')).toHaveTextContent('100.0 米');
  });

  it('标记结论并刷新恢复：结论保存在浏览器，重新挂载后仍在；可改判',()=>{
    seed([rec(1),rec(2,{longitude:lon(50)})]);
    const{unmount}=render(<App/>);
    openNear();
    const card=cardByNos('N-1','N-2');
    expect(within(card).getByText('待复核')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button',{name:'同点复采'}));
    expect(within(card).getByText('已判：同点复采')).toBeInTheDocument();
    const saved=JSON.parse(localStorage.getItem(NEAR_KEY)!);
    expect(saved).toHaveLength(1);
    expect(saved[0].verdict).toBe('duplicate');
    // 改判为“确为两份”
    fireEvent.click(within(card).getByRole('button',{name:'确为两份'}));
    expect(within(card).getByText('已判：确为两份')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(NEAR_KEY)!)[0].verdict).toBe('separate');
    // 刷新（重新挂载）后结论恢复，徽标清零
    unmount();
    render(<App/>);
    openNear();
    const card2=cardByNos('N-1','N-2');
    expect(within(card2).getByText('已判：确为两份')).toBeInTheDocument();
    expect(document.querySelector('.near-summary')!.textContent).toContain('0 对待复核 · 1 对已有结论');
    expect(screen.getByRole('button',{name:/^近地点复核/}).querySelector('.tab-count')).toBeNull();
  });

  it('编辑失效：任一方修改坐标后对应结论回到待复核；不影响其他对；存储中的失效结论被剔除',()=>{
    seed([rec(1),rec(2,{longitude:lon(50)}),rec(3,{longitude:lon(100)})]);
    render(<App/>);
    openNear();
    expect(nearCards()).toHaveLength(2); // (1,2) 与 (2,3)，无 (1,3)
    fireEvent.click(within(cardByNos('N-1','N-2')).getByRole('button',{name:'同点复采'}));
    fireEvent.click(within(cardByNos('N-2','N-3')).getByRole('button',{name:'确为两份'}));
    expect(JSON.parse(localStorage.getItem(NEAR_KEY)!)).toHaveLength(2);
    // 回到工作台把 id3 再东移 150 米：(2,3) 变 150 米仍在 200 米半径内但指纹已变；(1,3)=250 米不直接推断
    openDesk();
    editNo('N-3','经度',lon(250));
    // 编辑保存时失效结论即从存储剔除（不必进入复核区）：只剩 (1,2) 一条
    expect(JSON.parse(localStorage.getItem(NEAR_KEY)!)).toHaveLength(1);
    openNear();
    setRadius('200');
    expect(nearCards()).toHaveLength(2);
    // (2,3) 指纹变化：已判标记消失、回到待复核；(1,2) 结论仍有效
    expect(cardByNos('N-1','N-2').textContent).toContain('已判：同点复采');
    expect(within(cardByNos('N-2','N-3')).getByText('待复核')).toBeInTheDocument();
    // 对失效对重新标记时，仅这一条结论更新且存储不残留重复
    fireEvent.click(within(cardByNos('N-2','N-3')).getByRole('button',{name:'同点复采'}));
    const saved=JSON.parse(localStorage.getItem(NEAR_KEY)!);
    expect(saved).toHaveLength(2);
    expect(saved.map((c:{ids:string[]})=>c.ids.join(','))).toEqual(['id1,id2','id2,id3']);
  });

  it('编辑编号、物种、采集人或日期同样使对应结论失效，回到待复核',()=>{
    seed([rec(1),rec(2,{longitude:lon(50)})]);
    render(<App/>);
    openNear();
    fireEvent.click(within(cardByNos('N-1','N-2')).getByRole('button',{name:'同点复采'}));
    openDesk();
    editNo('N-1','采集编号','N-9');
    // 失效条目在编辑保存时即从存储剔除，无需进入复核区
    expect(JSON.parse(localStorage.getItem(NEAR_KEY)!)).toHaveLength(0);
    openNear();
    // 编号不同仍可配对，但旧结论绑定的是原编号指纹：标记消失、回到待复核
    expect(nearCards()).toHaveLength(1);
    expect(within(cardByNos('N-9','N-2')).getByText('待复核')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(NEAR_KEY)!)).toHaveLength(0);
  });

  it('改地点/生境备注不使结论失效',()=>{
    seed([rec(1),rec(2,{longitude:lon(50)})]);
    render(<App/>);
    openNear();
    fireEvent.click(within(cardByNos('N-1','N-2')).getByRole('button',{name:'同点复采'}));
    openDesk();
    editNo('N-2','地点','另一处地点');
    expect(JSON.parse(localStorage.getItem(NEAR_KEY)!)).toHaveLength(1); // 未改绑定字段：存储中的结论保留
    openNear();
    expect(cardByNos('N-1','N-2').textContent).toContain('已判：同点复采');
  });

  it('确认有效期：修改后撤销、刷新后改回原值、删除后恢复备份，旧结论均不复活',async()=>{
    vi.spyOn(window,'confirm').mockReturnValue(true);
    localStorage.setItem(BATCH_KEY,JSON.stringify(['id1','id4']));
    // 两对独立标签：A=(id1,id2) 采集人甲、B=(id3,id4) 采集人乙，对内相距 40 米，默认半径 50 米
    seed([
      rec(1,{collector:'甲'}),rec(2,{collector:'甲',longitude:lon(40)}),
      rec(3,{collector:'乙'}),rec(4,{collector:'乙',longitude:lon(40)}),
    ]);
    const{unmount}=render(<App/>);
    const storedKeys=()=>JSON.parse(localStorage.getItem(NEAR_KEY)||'[]').map((c:{pairKey:string})=>c.pairKey);
    const badge=()=>screen.getByRole('button',{name:/^近地点复核/}).querySelector('.tab-count')?.textContent??null;
    openNear();
    // 两对各自确认：待办清零，存储各一条
    fireEvent.click(within(cardByNos('N-1','N-2')).getByRole('button',{name:'同点复采'}));
    fireEvent.click(within(cardByNos('N-3','N-4')).getByRole('button',{name:'确为两份'}));
    expect(badge()).toBeNull();
    expect(storedKeys()).toEqual([pairKey('id1','id2'),pairKey('id3','id4')]);
    expect(document.querySelector('.near-summary')!.textContent).toContain('0 对待复核 · 2 对已有结论');

    // ① 修改后撤销（触及 A 对）：改 id1 编号 → A 回到待复核且存储立即剔除；B 对不受牵连
    openDesk();
    editNo('N-1','采集编号','N-1X');
    expect(storedKeys()).toEqual([pairKey('id3','id4')]);
    openNear();
    expect(within(cardByNos('N-1X','N-2')).getByText('待复核')).toBeInTheDocument();
    expect(cardByNos('N-3','N-4').textContent).toContain('已判：确为两份');
    expect(badge()).toBe('1');
    // 撤销把编号改回确认时的文本：旧结论不复活，A 保持待复核
    openDesk();
    fireEvent.click(screen.getByRole('button',{name:'撤销本次编辑'}));
    expect(storedKeys()).toEqual([pairKey('id3','id4')]);
    openNear();
    expect(within(cardByNos('N-1','N-2')).getByText('待复核')).toBeInTheDocument();
    expect(cardByNos('N-3','N-4').textContent).toContain('已判：确为两份');
    expect(badge()).toBe('1');

    // ② 刷新后改回原值（触及 B 对）：改 id3 经度 → B 待复核；刷新前后存储均无残留；改回原值仍不复活
    openDesk();
    editNo('N-3','经度',lon(45));
    expect(storedKeys()).toEqual([]);
    expect(badge()).toBe('2');
    unmount();
    expect(JSON.parse(localStorage.getItem(NEAR_KEY)!)).toEqual([]); // 刷新前：存储已清
    render(<App/>);
    expect(JSON.parse(localStorage.getItem(NEAR_KEY)!)).toEqual([]); // 刷新后：没有可复活的旧结论
    openNear();
    expect(within(cardByNos('N-1','N-2')).getByText('待复核')).toBeInTheDocument();
    expect(within(cardByNos('N-3','N-4')).getByText('待复核')).toBeInTheDocument();
    expect(badge()).toBe('2');
    openDesk();
    editNo('N-3','经度',lon(40)); // 改回确认时的文本
    expect(storedKeys()).toEqual([]);
    openNear();
    expect(within(cardByNos('N-3','N-4')).getByText('待复核')).toBeInTheDocument();
    expect(badge()).toBe('2');

    // ③ 删除后恢复备份（触及 A 对）：重新确认 A 后删除 id2，再导回含相同内部编号与字段的备份
    fireEvent.click(within(cardByNos('N-1','N-2')).getByRole('button',{name:'同点复采'}));
    expect(cardByNos('N-1','N-2').textContent).toContain('已判：同点复采'); // 只有重新确认才能恢复
    expect(storedKeys()).toEqual([pairKey('id1','id2')]);
    const backup=localStorage.getItem(KEY)!;
    openDesk();
    fireEvent.click(within(cardByName('N-2')).getByRole('button',{name:'删除'}));
    expect(storedKeys()).toEqual([]); // 删除即剔除，不等进入复核区
    openNear();
    expect(nearCards()).toHaveLength(1); // 只剩 B 对
    expect(badge()).toBe('1');
    openDesk();
    uploadJson(backup);
    expect(await screen.findByText('已恢复 4 条记录')).toBeInTheDocument();
    openNear();
    expect(nearCards()).toHaveLength(2);
    expect(within(cardByNos('N-1','N-2')).getByText('待复核')).toBeInTheDocument(); // 旧结论未随备份复活
    expect(within(cardByNos('N-3','N-4')).getByText('待复核')).toBeInTheDocument();
    expect(document.querySelector('.near-summary')!.textContent).toContain('2 对待复核 · 0 对已有结论');
    expect(badge()).toBe('2');
    expect(storedKeys()).toEqual([]);
    // 打印批次全程不受牵连
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(['id1','id4']);
  });

  it('存储失败时不留下已确认假象：按钮状态不变并提示错误',()=>{
    seed([rec(1),rec(2,{longitude:lon(50)})]);
    render(<App/>);
    openNear();
    const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('quota','QuotaExceededError')});
    fireEvent.click(within(cardByNos('N-1','N-2')).getByRole('button',{name:'同点复采'}));
    spy.mockRestore();
    expect(flashErr()).toContain('浏览器存储写入失败');
    expect(within(cardByNos('N-1','N-2')).getByText('待复核')).toBeInTheDocument();
    expect(localStorage.getItem(NEAR_KEY)).toBeNull();
    // 恢复后可正常标记
    fireEvent.click(within(cardByNos('N-1','N-2')).getByRole('button',{name:'同点复采'}));
    expect(within(cardByNos('N-1','N-2')).getByText('已判：同点复采')).toBeInTheDocument();
  });

  it('复核操作不改写原始记录、撤销项与打印批次',()=>{
    seed([rec(1),rec(2,{longitude:lon(50)})]);
    localStorage.setItem(BATCH_KEY,JSON.stringify(['id1','id2']));
    const before=localStorage.getItem(KEY);
    render(<App/>);
    openNear();
    fireEvent.click(within(cardByNos('N-1','N-2')).getByRole('button',{name:'同点复采'}));
    fireEvent.click(within(cardByNos('N-1','N-2')).getByRole('button',{name:'确为两份'}));
    // 工作集与批次逐字节不变
    expect(localStorage.getItem(KEY)).toBe(before);
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(['id1','id2']);
    // 复核区不出现任何预检问题处置控件，工作台上的记录仍完整
    openDesk();
    expect([...document.querySelectorAll('.record')]).toHaveLength(2);
  });

  it('采集编号相同的记录不进入近地点复核，仍由“采集编号重复”问题处理',()=>{
    seed([rec(1,{collectionNo:'DUP'}),rec(2,{collectionNo:'DUP',longitude:lon(50)})]);
    render(<App/>);
    openNear();
    setRadius('1000');
    expect(nearCards()).toHaveLength(0);
    openDesk();
    const c1=cardByName('DUP');
    expect(c1.textContent).toContain('采集编号重复');
    expect(within(c1).getByRole('button',{name:'合并比较'})).toBeInTheDocument();
  });

  it('不同采集人/日期/物种不配对',()=>{
    seed([
      rec(1),
      rec(2,{longitude:lon(50),collector:'乙'}),
      rec(3,{longitude:lon(50),date:'2026-03-02'}),
      rec(4,{longitude:lon(50),species:'柏 Cupressus'}),
    ]);
    render(<App/>);
    openNear();
    setRadius('1000');
    expect(nearCards()).toHaveLength(0);
  });
});
