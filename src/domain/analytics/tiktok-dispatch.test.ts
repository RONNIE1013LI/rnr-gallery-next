import { expect, it, vi } from 'vitest';
vi.mock('@next/third-parties/google',()=>({sendGAEvent:vi.fn()}));
import { emitAnalyticsEvent } from './client';
import { TIKTOK_EVENT } from './tiktok';
it('dispatches pre-payment events independently of GA transport and deduplicates the same action',()=>{
 const listener=vi.fn();window.addEventListener(TIKTOK_EVENT,listener);
 const event={event:'add_to_cart' as const,currency:'NZD' as const,value:50,items:[{item_id:'canvas',item_name:'private text',price:50,quantity:1}]};
 emitAnalyticsEvent(event);emitAnalyticsEvent(event);
 expect(listener).toHaveBeenCalledTimes(1);
 expect(JSON.stringify(listener.mock.calls[0][0].detail)).not.toContain('private text');
 window.removeEventListener(TIKTOK_EVENT,listener);
});
