"use client";

import { createModal } from "@irondsd/modal-kit";

const [ExampleModal, openExampleModal] = createModal(
  "ExampleModal",
  () => import("./ExampleModal")
);

export { ExampleModal, openExampleModal };
