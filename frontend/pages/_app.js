// frontend/pages/_app.js
import { Provider } from "react-redux";
import store from "../store/store";
// import "../styles/globals.css"; // 如果你有全局样式

function MyApp({ Component, pageProps }) {
  return (
    <Provider store={store}>
      <Component {...pageProps} />
    </Provider>
  );
}

export default MyApp;
