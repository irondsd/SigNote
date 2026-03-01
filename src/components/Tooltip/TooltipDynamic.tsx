// import {
//   useFloating,
//   useInteractions,
//   useHover,
//   useDismiss,
//   offset,
//   shift,
//   arrow,
//   flip,
//   autoUpdate,
//   safePolygon,
// } from "@floating-ui/react-dom-interactions";
// import type { Placement } from "@floating-ui/react-dom-interactions";
// import cx from "classnames";
// import Image from "next/image";
// import React, { useMemo, useState } from "react";

// import { Text } from "@/components/Text/Text";
// import { useDevice } from "@/hooks/useDevice";
// import { useTheme } from "@/providers/ThemeProvider";

// import s from "./Tooltip.module.scss";

// function renderTooltipContent(text: string | React.ReactNode) {
//   return Boolean(text) && typeof text === "string" ? (
//     <Text size={14} weight={500} value={text} html />
//   ) : (
//     text
//   );
// }

// export type TooltipProps = {
//   className?: string;
//   children: React.ReactElement;
//   text: string | React.ReactNode;
//   placement?: Placement;
//   mobPlacement?: Placement;
// };

// export const Tooltip: React.FC<TooltipProps> = (props) => {
//   const { className, children, text, mobPlacement } = props;

//   let defaultPlacement: Placement = props?.placement || "top";

//   const { isMobile } = useDevice();
//   const [isVisible, setVisibility] = useState(false);
//   const { theme } = useTheme();
//   const [arrowElement, setArrowElement] = useState(null);

//   if (mobPlacement && isMobile) {
//     defaultPlacement = mobPlacement;
//   }

//   let crossAxis = 0;

//   if (defaultPlacement === "top-start" || defaultPlacement === "bottom-start") {
//     crossAxis = -12;
//   } else if (
//     defaultPlacement === "top-end" ||
//     defaultPlacement === "bottom-end"
//   ) {
//     crossAxis = 12;
//   }

//   const arrowSrc = useMemo(() => {
//     return theme === "light"
//       ? "/images/tooltip-arrow-light.svg"
//       : "/images/tooltip-arrow.svg";
//   }, [theme]);

//   const {
//     x,
//     y,
//     reference,
//     floating,
//     placement,
//     strategy,
//     context,
//     middlewareData,
//   } = useFloating({
//     open: isVisible,
//     onOpenChange: setVisibility,
//     placement: defaultPlacement,
//     strategy: "absolute",
//     whileElementsMounted: autoUpdate,
//     middleware: [
//       offset({
//         mainAxis: 10,
//         crossAxis,
//       }),
//       shift({
//         padding: 10,
//       }),
//       arrow({
//         element: arrowElement,
//       }),
//       flip(),
//     ],
//   });

//   const { getReferenceProps, getFloatingProps } = useInteractions([
//     useHover(context, {
//       restMs: 10,
//       handleClose: safePolygon({
//         restMs: 10,
//       }),
//     }),
//     useDismiss(context),
//   ]);

//   const arrowClassNames = cx(s.arrow, {
//     [s.top]:
//       placement === "top" ||
//       placement === "top-end" ||
//       placement === "top-start",
//     [s.bottom]:
//       placement === "bottom" ||
//       placement === "bottom-end" ||
//       placement === "bottom-start",
//     [s.left]:
//       placement === "left" ||
//       placement === "left-end" ||
//       placement === "left-start",
//     [s.right]:
//       placement === "right" ||
//       placement === "right-end" ||
//       placement === "right-start",
//   });

//   // eslint-disable-next-line react-hooks/refs
//   const floatingProps = getFloatingProps({
//     ref: floating,
//     className: cx(s.tooltip, className),
//     style: {
//       position: strategy,
//       top: y ?? 0,
//       left: x ?? 0,
//     },
//   });

//   const referenceProps = getReferenceProps({
//     ref: reference,
//     ...children?.props,
//   });

//   const { arrow: { x: arrowX } = {} } = middlewareData;

//   const arrowStyle = {
//     left: arrowX,
//   };

//   const _content = renderTooltipContent(text);

//   // must have children
//   if (!children) return <div className="text-error-100">tooltip error 111</div>;
//   // react components must be wrapped in a div
//   const child = React.Children.only(children);

//   if (typeof child.type !== "string")
//     return <div className="text-error-100">tooltip error 115</div>;

//   return (
//     <>
//       {isVisible && (
//         <div ref={floating} {...floatingProps}>
//           <Image
//             ref={setArrowElement}
//             className={arrowClassNames}
//             style={arrowStyle}
//             src={arrowSrc}
//             width={12}
//             height={8}
//             alt="arrow"
//           />
//           {_content}
//         </div>
//       )}
//       {React.cloneElement(child, referenceProps)}
//     </>
//   );
// };
