// D:\OLS\frontend\pages\_app.js
import "../src/app/globals.css"; // 确保这个路径正确
import { Provider } from "react-redux";
import store from "../store/store";

function MyApp({ Component, pageProps }) {
  return (
    <Provider store={store}>
      <Component {...pageProps} />
    </Provider>
  );
}

export default MyApp;
