import {test} from 'node:test';
import assert from 'node:assert/strict';
import {offerPromotion} from '../src/promotions.js';
test('descuento exclusivamente a partir del precio original del proveedor y misma moneda',()=>{
 const offer={offerRetailRate:{amount:80,currency:'EUR'},offerInitialPrice:{amount:100,currency:'EUR'},rates:[{retailRate:{promotions:[{name:'Oferta de otoño'}]}}]};
 assert.deepEqual(offerPromotion(offer),{originalTotal:100,total:80,savings:20,percent:20,currency:'EUR',names:['Oferta de otoño']});
 assert.equal(offerPromotion({...offer,offerInitialPrice:{amount:100,currency:'USD'}}),null);
 assert.equal(offerPromotion({...offer,offerInitialPrice:80}),null);
 assert.equal(offerPromotion({...offer,offerInitialPrice:undefined,rates:[{retailRate:{suggestedSellingPrice:[{amount:200,currency:'EUR'}]}}]}),null);
});
test('precio inicial por tarifa solo cuando representa una habitación completa',()=>{
 const o={offerRetailRate:{amount:163.66},rates:[{retailRate:{initialPrice:[{amount:210,currency:'EUR'}]}}]};
 assert.equal(offerPromotion(o).savings,46.34);
 assert.equal(offerPromotion(o,2),null);
 assert.equal(offerPromotion({...o,offerInitialPrice:{amount:300}},2).originalTotal,300);
});
