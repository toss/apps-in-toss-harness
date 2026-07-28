import { describe, expect, it } from 'vitest';
import { installObjectMethods, restoreObjectMethods } from '../shims/_install-helpers.js';

describe('installObjectMethods', () => {
  it('replaces the named own methods on the target and reports the swap in the snapshot', () => {
    const originalA = () => 'original-a';
    const originalB = () => 'original-b';
    const target = { a: originalA, b: originalB };

    const replacementA = () => 'shim-a';
    const replacementB = () => 'shim-b';

    const snapshot = installObjectMethods(target, { a: replacementA, b: replacementB });

    expect(snapshot).not.toBeNull();
    expect(target.a).toBe(replacementA);
    expect(target.b).toBe(replacementB);
    expect(snapshot?.methods.a).toEqual({ hadOwn: true, original: originalA });
    expect(snapshot?.methods.b).toEqual({ hadOwn: true, original: originalB });
    expect(snapshot?.target).toBe(target);
  });

  it('records inherited methods as hadOwn=false so restore deletes instead of re-assigning', () => {
    const proto = { a: () => 'proto-a' };
    const target = Object.create(proto) as { a?: () => string };

    const replacement = () => 'shim-a';
    const snapshot = installObjectMethods(target, { a: replacement });

    if (!snapshot) throw new Error('install should have succeeded');
    const entry = snapshot.methods.a;
    if (!entry) throw new Error('snapshot.methods.a should be present');
    expect(entry.hadOwn).toBe(false);
    // The original we captured should be the inherited method, so restore can
    // either delete (preferred) or reassign without changing visible behavior.
    expect(entry.original).toBe(proto.a);
    // After install, an own override should shadow the prototype.
    expect(Object.hasOwn(target, 'a')).toBe(true);
  });

  it('returns null when the target has a non-writable, non-configurable method slot', () => {
    const originalA = () => 'frozen-a';
    const target: { a: () => string } = { a: originalA };
    Object.defineProperty(target, 'a', {
      value: originalA,
      writable: false,
      configurable: false,
      enumerable: true,
    });

    const snapshot = installObjectMethods(target, { a: () => 'shim-a' });

    expect(snapshot).toBeNull();
    // Install must leave the target untouched on failure.
    expect(target.a).toBe(originalA);
  });

  it('restoreObjectMethods reassigns originals when they were own properties', () => {
    const originalA = () => 'original-a';
    const target = { a: originalA };

    const replacement = () => 'shim-a';
    const snapshot = installObjectMethods(target, { a: replacement });
    if (!snapshot) throw new Error('install should have succeeded');

    restoreObjectMethods(snapshot);

    expect(target.a).toBe(originalA);
    expect(Object.hasOwn(target, 'a')).toBe(true);
  });

  it('restoreObjectMethods deletes the override when the method was inherited', () => {
    const proto = { a: () => 'proto-a' };
    const target = Object.create(proto) as { a?: () => string };

    const snapshot = installObjectMethods(target, { a: () => 'shim-a' });
    if (!snapshot) throw new Error('install should have succeeded');
    expect(Object.hasOwn(target, 'a')).toBe(true);

    restoreObjectMethods(snapshot);

    expect(Object.hasOwn(target, 'a')).toBe(false);
    // The prototype method shows through again.
    expect(target.a).toBe(proto.a);
  });
});
