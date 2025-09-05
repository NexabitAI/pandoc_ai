import React from "react";

const DoctorList = ({ payload }) => {
    return (
        <div className="space-y-4">
            {payload.map((doc, i) => (
                <div
                    key={doc._id}
                    className="p-4 rounded shadow-sm"
                    style={{ backgroundColor: "#2563eb", color: "#ffffff" }}
                >
                    <p className="font-semibold">{i + 1}. {doc.name}</p>
                    <p>Speciality: {doc.speciality}</p>
                    <p>Fee: ${doc.fees}</p>
                    <a
                        href={`https://www.mypandoc.com/appointment/${doc._id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block mt-2 bg-white text-blue-600 px-3 py-1 rounded font-medium"
                    >
                        🔗 Book Appointment
                    </a>
                </div>
            ))}
        </div>
    );
};

export default DoctorList;
