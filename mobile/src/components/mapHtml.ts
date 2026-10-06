export interface MapData {
  store?: { lat: number; lng: number } | null;
  destination?: { lat: number; lng: number } | null;
  rider?: { lat: number; lng: number } | null;
}

/**
 * Self-contained Leaflet map (OpenStreetMap tiles, no API key). It is rendered inside a WebView on phones and an
 * iframe on the web, and is driven by `window.update({ store, destination, rider })` / postMessage.
 */
export const MAP_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
<style>
html,body,#m{height:100%;margin:0;background:#EAF4FE;font-family:sans-serif}
.leaflet-marker-icon{transition:transform .9s linear}
.pin{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:21px;box-shadow:0 4px 12px rgba(15,33,71,.35);border:3px solid #fff}
.pulse{animation:p 1.6s ease-out infinite}@keyframes p{0%{box-shadow:0 0 0 0 rgba(11,95,219,.55)}100%{box-shadow:0 0 0 18px rgba(11,95,219,0)}}
.msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#4F5D78;font-size:13px;text-align:center;padding:24px}
</style></head><body><div id="m"></div><div class="msg" id="msg">Loading map…</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script>
(function(){
  if(!window.L){document.getElementById('msg').textContent='Map unavailable offline';return}
  var map=L.map('m',{zoomControl:false,attributionControl:true}).setView([26.85,75.76],14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
  document.getElementById('msg').style.display='none';
  function icon(html,bg,extra){return L.divIcon({className:'',html:'<div class="pin '+(extra||'')+'" style="background:'+bg+'">'+html+'</div>',iconSize:[42,42],iconAnchor:[21,21]})}
  var m={store:null,dest:null,rider:null,line:null},first=true;
  function put(key,pt,ic){
    if(!pt){if(m[key]){map.removeLayer(m[key]);m[key]=null}return}
    if(m[key]){m[key].setLatLng([pt.lat,pt.lng])}else{m[key]=L.marker([pt.lat,pt.lng],{icon:ic}).addTo(map)}
  }
  window.update=function(d){
    d=d||{};
    put('store',d.store,icon('&#127973;','#0B5FDB'));
    put('dest',d.destination,icon('&#127968;','#1B9A47'));
    put('rider',d.rider,icon('&#128693;','#F5A623','pulse'));
    if(m.line){map.removeLayer(m.line);m.line=null}
    var a=d.rider||d.store,b=d.destination;
    if(a&&b){m.line=L.polyline([[a.lat,a.lng],[b.lat,b.lng]],{color:'#0B5FDB',weight:4,opacity:.65,dashArray:'8 10'}).addTo(map)}
    var pts=[d.store,d.destination,d.rider].filter(Boolean).map(function(p){return [p.lat,p.lng]});
    if(pts.length===1){map.setView(pts[0],15)}
    else if(pts.length>1){map.fitBounds(pts,{padding:[50,50],maxZoom:16,animate:!first})}
    first=false;
  };
  function onMsg(e){try{window.update(JSON.parse(typeof e.data==='string'?e.data:JSON.stringify(e.data)))}catch(_){}}
  window.addEventListener('message',onMsg);document.addEventListener('message',onMsg);
  if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage('ready')}else{parent.postMessage('ready','*')}
})();
</script></body></html>`;
