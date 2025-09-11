import React from "react";

const DoctorList = ({ payload }) => {
  return (
    <div className="space-y-4">
      {payload.map((doc, i) => (
        <div key={doc._id} className="p-4 rounded border border-gray-200">
          <p className="font-semibold">{i + 1}. {doc.name}</p>
          <p className="text-sm text-gray-700">Speciality: {doc.speciality}</p>
          {doc.gender ? <p className="text-sm text-gray-700">Gender: {doc.gender}</p> : null}
          <p className="text-sm text-gray-700">Experience: {doc.experience}</p>
          <p className="text-sm text-gray-700">Fee: ${doc.fees}</p>
          <a
            href={`https://www.mypandoc.com/appointment/${doc._id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-2 bg-[#EAEFFF] text-gray-700 px-3 py-1 rounded"
          >
            View profile
          </a>
        </div>
      ))}
    </div>
  );
};

export default DoctorList;
