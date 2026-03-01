
import { Button } from "@/components/Button/Button";
import { openExampleModal, ExampleModal } from "@/compositions/ExampleModal";


export default function Home() {
  return (
    <div className="flex flex-col w-full overflow-y-hidden">
      123
      <Button onClick={openExampleModal}>Open Modal</Button>
      <ExampleModal />
    </div>
  );
}
