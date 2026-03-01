// "use client";

// import React, { useState } from "react";
// import { lazy, Suspense } from "react";

// import type { TooltipProps } from "./TooltipDynamic";

// const TooltipDynamic = lazy(() =>
//   import("./TooltipDynamic").then((module) => ({ default: module.Tooltip }))
// );

// export const Tooltip: React.FC<TooltipProps> = (props) => {
//   const [isHovered, setIsHovered] = useState(false);

//   const setHovered = () => setIsHovered(true);

//   if (!isHovered)
//     return (
//       <span onMouseEnter={setHovered} onMouseDown={setHovered}>
//         {props.children}
//       </span>
//     );

//   return (
//     <Suspense fallback={props.children}>
//       {/* <TooltipDynamic {...props} /> */}
//     </Suspense>
//   );
// };
