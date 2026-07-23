import { describe, expect, it } from 'vitest';
import {
  clampConversationDebugCanvasZoom,
  conversationDebugHorizontalAreaScrollLeft,
  conversationDebugHorizontalScrollProgress,
  conversationDebugWheelHorizontalDelta,
  conversationDebugZoomAnchorScroll,
} from '../../../../src/features/conversation-debug/useConversationDebugCanvasNavigation.js';

describe('conversation debug canvas navigation', () => {
  it('clamps zoom to the supported canvas range', () => {
    expect(clampConversationDebugCanvasZoom(0.1)).toBe(0.45);
    expect(clampConversationDebugCanvasZoom(1.25)).toBe(1.25);
    expect(clampConversationDebugCanvasZoom(3)).toBe(1.8);
  });

  it('keeps the content beneath the pointer stable while zooming', () => {
    expect(conversationDebugZoomAnchorScroll({
      currentZoom: 1,
      nextZoom: 1.5,
      scrollLeft: 300,
      scrollTop: 120,
      viewportX: 200,
      viewportY: 80,
    })).toEqual({
      left: 550,
      top: 220,
    });
  });

  it('centers compact turns and aligns wide turns to the viewport start', () => {
    expect(conversationDebugHorizontalAreaScrollLeft({
      areaLeft: 1_000,
      areaWidth: 300,
      viewportWidth: 800,
      zoom: 1,
    })).toBe(750);
    expect(conversationDebugHorizontalAreaScrollLeft({
      areaLeft: 1_000,
      areaWidth: 1_200,
      padding: 150,
      viewportWidth: 800,
      zoom: 1,
    })).toBe(850);
    expect(conversationDebugHorizontalAreaScrollLeft({
      areaLeft: 100,
      areaWidth: 200,
      viewportWidth: 800,
      zoom: 0.5,
    })).toBe(0);
  });

  it('maps the dominant wheel axis to horizontal canvas movement', () => {
    expect(conversationDebugWheelHorizontalDelta({
      deltaMode: 0,
      deltaX: 8,
      deltaY: 40,
      pageSize: 800,
    })).toBe(40);
    expect(conversationDebugWheelHorizontalDelta({
      deltaMode: 0,
      deltaX: -50,
      deltaY: 8,
      pageSize: 800,
    })).toBe(-50);
    expect(conversationDebugWheelHorizontalDelta({
      deltaMode: 1,
      deltaX: 0,
      deltaY: 3,
      pageSize: 800,
    })).toBe(48);
    expect(conversationDebugWheelHorizontalDelta({
      deltaMode: 2,
      deltaX: 0,
      deltaY: 1,
      pageSize: 800,
    })).toBe(800);
  });

  it('positions a viewport-sized progress thumb across the scrollable width', () => {
    expect(conversationDebugHorizontalScrollProgress({
      contentWidth: 1_000,
      scrollLeft: 0,
      viewportWidth: 400,
    })).toEqual({
      left: 0,
      visible: true,
      width: 160,
    });
    expect(conversationDebugHorizontalScrollProgress({
      contentWidth: 1_000,
      scrollLeft: 300,
      viewportWidth: 400,
    })).toEqual({
      left: 120,
      visible: true,
      width: 160,
    });
    expect(conversationDebugHorizontalScrollProgress({
      contentWidth: 1_000,
      scrollLeft: 600,
      viewportWidth: 400,
    })).toEqual({
      left: 240,
      visible: true,
      width: 160,
    });
    expect(conversationDebugHorizontalScrollProgress({
      contentWidth: 400,
      scrollLeft: 0,
      viewportWidth: 400,
    })).toEqual({
      left: 0,
      visible: false,
      width: 400,
    });
  });
});
