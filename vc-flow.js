/* 24-hour flow context: turnover feeds and the Bullish / Bearish / Neutral rule.
   Same code as fragility/shared/vanna-flow/core.mjs (the ETH phone alert); the fragility
   test checks they match. */
var FlowContext = (function () {
  function finite(x){return typeof x==='number'&&Number.isFinite(x)}
var venues=['Binance','Bybit','Bitget','Gate','Deribit'],TTL=10*6e4;
function fresh(at,now){return finite(at)&&now-at>=-6e4&&now-at<=TTL}
function feedUrls(asset){return [
 'https://fapi.binance.com/fapi/v1/ticker/24hr?symbol='+asset+'USDT',
 'https://api.bybit.com/v5/market/tickers?category=linear&symbol='+asset+'USDT',
 'https://api.bitget.com/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol='+asset+'USDT',
 'https://api.gateio.ws/api/v4/futures/usdt/tickers?contract='+asset+'_USDT',
 'https://www.deribit.com/api/v2/public/ticker?instrument_name='+asset+'-PERPETUAL'];}
// Quote turnover only: never contract count, base-coin volume or volume × last price.
function volumeRecord(venue,j,asset,now){
 if(!j||!['ETH','BTC'].includes(asset))return null;
 var r,amount,at,symbol,expected=asset+'USDT',clock='exchange',unit='USDT';
 if(venue==='Binance'){r=j;amount=r.quoteVolume;at=r.closeTime;symbol=r.symbol}
 else if(venue==='Bybit'){r=j.retCode===0&&j.result&&Array.isArray(j.result.list)&&j.result.list.length===1&&j.result.list[0];if(!r)return null;amount=r.turnover24h;at=j.time;symbol=r.symbol}
 else if(venue==='Bitget'){r=j.code==='00000'&&Array.isArray(j.data)&&j.data.length===1&&j.data[0];if(!r)return null;amount=r.usdtVolume;at=r.ts;symbol=r.symbol}
 else if(venue==='Gate'){r=Array.isArray(j)&&j.length===1&&j[0];if(!r)return null;amount=r.volume_24h_quote;at=now;symbol=r.contract;expected=asset+'_USDT';clock='retrieved'}
 else if(venue==='Deribit'){r=!j.error&&j.result;if(!r||r.state!=='open')return null;amount=r.stats&&r.stats.volume_usd;at=r.timestamp;symbol=r.instrument_name;expected=asset+'-PERPETUAL';unit='USD'}
 else return null;
 amount=typeof amount==='string'||typeof amount==='number'?Number(amount):NaN;at=Number(at);
 return symbol===expected&&finite(amount)&&amount>0&&fresh(at,now)?{venue:venue,asset:asset,amount:amount,at:at,receivedAt:now,clock:clock,unit:unit}:null;
}
function volumeSelection(ctx,now){
 var records=ctx&&ctx.records||{},health=ctx&&ctx.health||{};
 var available=venues.map(function(v){return records[v]}).filter(function(r){return r&&r.asset===ctx.asset&&finite(r.amount)&&r.amount>0&&fresh(r.at,now)&&fresh(r.receivedAt,now)});
 // Prefer successful current responses over retained values; preserve exchange priority within each group.
 available.sort(function(a,b){return Number(!!health[a.venue])-Number(!!health[b.venue])||venues.indexOf(a.venue)-venues.indexOf(b.venue)});
 var used=available.slice(0,2),total=used.reduce(function(s,r){return s+r.amount},0),complete=used.length===2;
 return {used:used,total:used.length?total:null,volume:complete?total:null,complete:complete,fallback:complete&&!(used.some(function(r){return r.venue==='Binance'})&&used.some(function(r){return r.venue==='Bybit'})),retained:used.some(function(r){return !!health[r.venue]})};
}
function validVolume(ctx,now){return volumeSelection(ctx,now).volume}
function bias(vanna,charm,volume,netGamma,stale){
 var threshold=volume>0?volume*.0001:null; // explicit provisional neutral band: 0.01% of turnover
 var rows=[-3,0,3].map(function(iv){var v=-vanna*iv,c=-charm,total=v+c,gross=Math.abs(v)+Math.abs(c);var cancel=gross>0&&Math.abs(total)<=.1*gross;
  var tiny=Math.abs(total)<1||(threshold!==null&&Math.abs(total)<threshold);
  return {iv:iv,vanna:v,charm:c,total:total,label:tiny||cancel?'Neutral':total>0?'Bullish':'Bearish',cancel:cancel};});
 var robust=rows.every(function(r){return r.label===rows[1].label}),pct=volume>0?Math.abs(rows[1].total)/volume*100:null;
 var base=pct===null?null:pct<.1?0:pct<=.3?1:2;
 var adjusted=base===null?null:Math.min(2,base+(netGamma<0&&rows[1].label!=='Neutral'&&robust?1:0));
 return {rows:rows,robust:robust,label:stale?'Unavailable':!robust?'Neutral':volume===null?'Unavailable':rows[1].label,threshold:threshold,pct:pct,base:base,adjusted:adjusted};
}
  return { venues: venues, TTL: TTL, fresh: fresh, feedUrls: feedUrls, volumeRecord: volumeRecord, volumeSelection: volumeSelection, validVolume: validVolume, bias: bias };
})();
