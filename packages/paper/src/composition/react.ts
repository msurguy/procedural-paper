// The build preserves this entry as a client boundary.
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react';
import { createPaperComposition, type CompositionHandle, type CompositionOptions } from './index';
export interface PaperCompositionProps extends CompositionOptions {
  className?: string; style?: CSSProperties; onReady?: () => void; onError?: (error: unknown) => void;
}
export type PaperCompositionRef = Pick<CompositionHandle, 'play' | 'pause' | 'replay' | 'seek'>;
export const PaperComposition = forwardRef<PaperCompositionRef, PaperCompositionProps>(function PaperComposition(props, ref) {
  const host = useRef<HTMLDivElement>(null), component = useRef<CompositionHandle | undefined>(undefined);
  const callbacks = useRef(props); callbacks.current = props;
  useImperativeHandle(ref, () => ({ play: () => component.current?.play(), pause: () => component.current?.pause(), replay: () => component.current?.replay(), seek: p => component.current?.seek(p) }), []);
  useEffect(() => {
    const value = createPaperComposition(props); component.current = value; host.current!.append(value.element);
    let mounted = true;
    value.ready.then(() => { if (mounted) callbacks.current.onReady?.(); }, error => { if (mounted) callbacks.current.onError?.(error); });
    return () => { mounted = false; value.dispose(); component.current = undefined; };
  }, [props.composition, props.resolveAsset, props.autoplay, props.fit, props.renderer]);
  return createElement('div', { ref: host, className: props.className, style: props.style, 'aria-label': props.composition.info.kind });
});
