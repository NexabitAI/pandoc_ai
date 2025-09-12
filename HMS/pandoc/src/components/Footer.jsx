import React from "react";
import { assets } from "../assets/assets";

const Footer = () => {
  return (
    <div className="md:mx-10">
      <div className="flex flex-col sm:grid grid-cols-[3fr_1fr_1fr] gap-14 my-10  mt-40 text-sm">
        <div>
          <img
            className="mb-5 w-40"
            src={assets.logo}
            alt=""
          />
          <p className="w-full md:w-2/3 text-gray-600 leading-6">
            Pandoc is a powerful universal document converter for
writers and developers. It reads Markdown, HTML,
LaTeX, and more, then outputs clean PDFs, Word,
or web pages with citations and code blocks, all
while keeping styles consistent and repeatable
across projects and teams.
          </p>
        </div>

        <div>
          <p className="text-xl font-medium mb-5">
            COMPANY
          </p>
          <ul className="flex flex-col gap-2 text-gray-600">
            <li>Home</li>
            <li>About us</li>
            <li>Delivery</li>
            <li>Privacy policy</li>
          </ul>
        </div>

        <div>
          <p className="text-xl font-medium mb-5">
            GET IN TOUCH
          </p>
          <ul className="flex flex-col gap-2 text-gray-600">
            <li>+1 (202) 555-0199</li>
            <li>info@mypandoc.com</li>
          </ul>
        </div>
      </div>

      <div>
        <hr />
        <p className="py-5 text-sm text-center">
          Copyright 2025 @ mypandoc.com - All Right Reserved.
        </p>
      </div>
    </div>
  );
};

export default Footer;
