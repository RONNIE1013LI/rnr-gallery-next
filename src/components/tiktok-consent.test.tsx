import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConsentPreferences, CookiePreferencesTrigger, useExplicitAdvertisingConsent } from './consent-preferences';
function Probe(){return <><output>{String(useExplicitAdvertisingConsent())}</output><CookiePreferencesTrigger/></>;}
afterEach(()=>{sessionStorage.clear();vi.unstubAllGlobals();});
it('does not treat automatic or historical advertising acceptance as explicit TikTok permission',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({consent:{version:1,analytics:true,advertising:true,decidedAt:'2026-10-21T00:00:00.000Z'}}))));
 render(<ConsentPreferences initialConsent={null}><Probe/></ConsentPreferences>);
 await screen.findByRole('button',{name:'Cookie preferences'});
 expect(screen.getByText('false')).toBeInTheDocument();
});
it('grants after manual choice and revokes immediately even if consent save fails',async()=>{
 const saved={version:1 as const,analytics:true,advertising:true,decidedAt:'2026-10-21T00:00:00.000Z'};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({consent:saved}))).mockResolvedValueOnce(new Response('',{status:500})));
 render(<ConsentPreferences initialConsent={saved}><Probe/></ConsentPreferences>);
 expect(screen.getByText('false')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Cookie preferences'}));
 fireEvent.click(screen.getByRole('button',{name:'Accept all'}));
 await waitFor(()=>expect(screen.getByText('true')).toBeInTheDocument());
 fireEvent.click(screen.getByRole('button',{name:'Cookie preferences'}));
 fireEvent.click(screen.getByRole('button',{name:'Essential only'}));
 expect(screen.getByText('false')).toBeInTheDocument();
 await screen.findByRole('alert');
});

it('retains this tab explicit choice across remounts without trusting an unrelated consent timestamp',()=>{
 const saved={version:1 as const,analytics:true,advertising:true,decidedAt:'2026-10-21T00:00:00.000Z'};
 sessionStorage.setItem('rnr:tiktok:explicit-consent:v1',saved.decidedAt);
 const view=render(<ConsentPreferences initialConsent={saved}><Probe/></ConsentPreferences>);
 expect(screen.getByText('true')).toBeInTheDocument();
 view.unmount();
 render(<ConsentPreferences initialConsent={{...saved,decidedAt:'2026-10-22T00:00:00.000Z'}}><Probe/></ConsentPreferences>);
 expect(screen.getByText('false')).toBeInTheDocument();
});
