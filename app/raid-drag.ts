'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { CharacterRef } from '../lib/armory';

type Party = 1|2;
export type DragSource = {run:string;party:Party;slot:number;nick:string;character:CharacterRef};
export type DragDestination = {party:Party;slot:number};

type DragGesture = {
  source:DragSource;
  pointerId:number;
  originX:number;
  originY:number;
  x:number;
  y:number;
  active:boolean;
};

function dropAt(gesture:DragGesture):DragDestination|undefined {
  const node=document.elementFromPoint(gesture.x,gesture.y)?.closest<HTMLElement>('[data-raid-drop]');
  if (!node || node.dataset.raidDrop!==gesture.source.run) return;
  const party=Number(node.dataset.dropParty);
  const slot=Number(node.dataset.dropSlot);
  if ((party===1||party===2) && party!==gesture.source.party && slot>=1 && slot<=5) return {party,slot};
}

export function useRaidDrag(move:(source:DragSource,destination:DragDestination)=>void) {
  const gesture=useRef<DragGesture>(undefined);
  const hold=useRef<number>(undefined);
  const scroll=useRef<number>(undefined);
  const [drag,setDrag]=useState<{source:DragSource;x:number;y:number;target?:DragDestination}>();

  function paint(current:DragGesture) {
    setDrag({source:current.source,x:current.x,y:current.y,target:dropAt(current)});
  }

  function scrollWhileDragging() {
    const current=gesture.current;
    if (!current?.active) return;
    const margin=Math.min(76,window.innerHeight/5);
    const amount=current.y<margin ? -Math.ceil((margin-current.y)/5)
      : current.y>window.innerHeight-margin ? Math.ceil((current.y-window.innerHeight+margin)/5) : 0;
    if (amount) {
      const before=window.scrollY;
      window.scrollBy(0,amount);
      if (window.scrollY!==before) paint(current);
    }
    scroll.current=window.requestAnimationFrame(scrollWhileDragging);
  }

  function activate(current:DragGesture) {
    if (current.active || gesture.current!==current) return;
    current.active=true;
    paint(current);
    scroll.current=window.requestAnimationFrame(scrollWhileDragging);
  }

  function clear() {
    window.clearTimeout(hold.current);
    if (scroll.current!==undefined) window.cancelAnimationFrame(scroll.current);
    gesture.current=undefined;
    setDrag(undefined);
  }

  useEffect(()=>()=> {
    window.clearTimeout(hold.current);
    if (scroll.current!==undefined) window.cancelAnimationFrame(scroll.current);
  },[]);

  function handle(source:DragSource) {
    function end(event:PointerEvent<HTMLButtonElement>,drop:boolean) {
      const current=gesture.current;
      if (current?.pointerId!==event.pointerId) return;
      const target=drop&&current.active ? dropAt({...current,x:event.clientX,y:event.clientY}) : undefined;
      clear();
      if (target) move(current.source,target);
    }
    return {
      onPointerDown(event:PointerEvent<HTMLButtonElement>) {
        if (!event.isPrimary || event.button!==0 || gesture.current) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const current:DragGesture={source,pointerId:event.pointerId,originX:event.clientX,originY:event.clientY,
          x:event.clientX,y:event.clientY,active:false};
        gesture.current=current;
        if (event.pointerType!=='mouse') hold.current=window.setTimeout(()=>activate(current),180);
      },
      onPointerMove(event:PointerEvent<HTMLButtonElement>) {
        const current=gesture.current;
        if (current?.pointerId!==event.pointerId) return;
        current.x=event.clientX;current.y=event.clientY;
        if (current.active) paint(current);
        else if (Math.hypot(current.x-current.originX,current.y-current.originY)>6) {
          if (event.pointerType==='mouse') activate(current);
          else clear();
        }
      },
      onPointerUp(event:PointerEvent<HTMLButtonElement>) {end(event,true);},
      onPointerCancel(event:PointerEvent<HTMLButtonElement>) {end(event,false);},
      onLostPointerCapture(event:PointerEvent<HTMLButtonElement>) {end(event,false);},
    };
  }
  return {drag,handle,cancel:clear};
}
