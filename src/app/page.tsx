
import { Button } from "@/components/Button/Button";
import { ConnectButton } from "@/components/ConnectButton/ConnectButton";
import { openExampleModal, ExampleModal } from "@/compositions/ExampleModal";



export default function Home() {
  return (
    <div className="flex flex-col w-full overflow-y-hidden gap-4">
      <Button onClick={openExampleModal}>Open Modal</Button>
      <ConnectButton />
      <ExampleModal />
    </div>
  );
}
