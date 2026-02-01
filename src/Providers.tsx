import { Outlet } from "react-router-dom";
import { SessionProvider } from "./context/SessionContext";
import { UserProfileProvider } from "./context/UserProfileContext";

const Providers = () => {
  return (
    <SessionProvider>
      <UserProfileProvider>
        <Outlet />
      </UserProfileProvider>
    </SessionProvider>
  );
};

export default Providers;
