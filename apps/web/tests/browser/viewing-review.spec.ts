import {expect,test} from '@playwright/test';
for(const agree of [true,false])test(`review before ${agree?'agreement':'automatic removal'}`,async({page})=>{
 const item:any={listing_id:'home-1',title:'Căn đã xem',status:'visit_due',snapshot:{address:'Hà Nội',price_vnd:5000000},viewing:{slot:'2026-10-14T09:00:00+07:00'},landlord:{request_status:'viewing',viewing_status:'confirmed'}};
 const viewing:any={items:[item],slots:[],max_selected:4,test_visit_anytime:true};
 const thread={id:'th_review',title:'Đánh giá buổi xem',messages:[],runs:[],state:{plan:{version:1,tasks:[]},intake:{user_confirmed_facts:{}},viewing}};
 const calls:any[]=[];
 await page.route('**/web/api/**',route=>{
  const path=new URL(route.request().url()).pathname.replace('/web/api','');
  let data:any={};
  if(path==='/session')data={id:'tenant',name:'Mai',preferences:{}};
  else if(path==='/threads' || path==='/saved')data=[];
  else if(path==='/status')data={status:'ok',domains:['property']};
  else if(path==='/threads/th_review')data=thread;
  else if(path.endsWith('/visit-review')){
   const body=route.request().postDataJSON();calls.push(body);item.visit_review={rating:body.rating,body:body.body};item.visit_outcome={outcome:body.outcome};
   item.status=agree?'visited':'dropped';if(!agree){viewing.items=[];viewing.history=[item]}data=viewing;
  }else if(path.endsWith('/viewings'))data=viewing;
  return route.fulfill({json:data});
 });
 await page.goto('/ai/th_review?panel=plan&planTab=viewing');
 await expect(page.getByRole('button',{name:'Đã gặp, còn phân vân',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Không đi được',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:agree?'Đã gặp, đồng ý':'Đã gặp, không đồng ý',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Đánh giá sau buổi xem'});
 await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:/Gửi đánh giá/})).toBeDisabled();
 await dialog.getByRole('radio',{name:'4 sao',exact:true}).check();await dialog.getByLabel('Nhận xét (không bắt buộc)').fill('Chủ nhà trao đổi rõ ràng.');
 await dialog.getByRole('button',{name:/Gửi đánh giá/}).click();
 await expect.poll(()=>calls).toEqual([{listing_id:'home-1',outcome:agree?'met_agreed':'met_rejected',rating:4,body:'Chủ nhà trao đổi rõ ràng.'}]);
 if(agree)await expect(page.getByRole('dialog',{name:'Chốt Căn đã xem',exact:true})).toBeVisible();
 else await expect(page.locator('.bulk-home-card')).toHaveCount(0);
});
